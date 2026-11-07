"""Read-only T12 workflow grammar/contract validation. Tool dependency: PyYAML==6.0.2."""
from pathlib import Path
import re
import yaml

ROOT = Path(__file__).resolve().parents[1]


class Loader(yaml.BaseLoader):
    def construct_mapping(self, node, deep=False):
        keys = [self.construct_object(key, deep=deep) for key, _ in node.value]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate workflow key")
        return super().construct_mapping(node, deep)


def check():
    paths = sorted((ROOT / '.github/workflows').glob('*.yml'))
    for path in paths:
        text = path.read_text(encoding='utf-8')
        assert len(text) < 131072
        assert not any(isinstance(t, (yaml.tokens.AliasToken, yaml.tokens.AnchorToken)) for t in yaml.scan(text))
        data = yaml.load(text, Loader=Loader)
        assert data['permissions']['contents'] == 'read'
        assert 'pull_request_target' not in data['on']
        for permission in data['permissions'].values():
            assert permission in ('read', 'none')
        for job in data['jobs'].values():
            for permission in job.get('permissions', {}).values():
                assert permission in ('read', 'none')
            for step in job.get('steps', []):
                if 'uses' in step:
                    assert re.fullmatch(r'[\w-]+/[\w-]+@[a-f0-9]{40}', step['uses'])
                # Untrusted dispatch values belong in env/structured action inputs, never shell source.
                assert '${{ inputs.' not in step.get('run', '')
                assert '${{ secrets.' not in str(step)
        if path.name == 'verify.yml':
            assert set(('push', 'pull_request', 'workflow_dispatch', 'workflow_call')) <= data['on'].keys()
        else:
            assert set(data['on']) == {'workflow_dispatch'}
            assert data['concurrency']['cancel-in-progress'] == 'false'
            for job in data['jobs'].values():
                assert "ENABLED == 'true'" in job['if']
                assert 'repository.default_branch' in job['if']
                assert 'self-hosted' not in str(job)
            assert not re.search(r'--push\b|docker push\b|compose[^\n]* up\b|\bssh\b', text)
    assert len(paths) == 3, 'Review new workflows explicitly before extending the release policy'
    print('PASS: 3 workflows parsed; closed manual triggers, SHA pins, read-only permissions, concurrency and shell input boundaries')


if __name__ == '__main__':
    check()
