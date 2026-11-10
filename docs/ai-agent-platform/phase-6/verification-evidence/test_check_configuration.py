"""Regression coverage for historical evidence checkout portability."""
import hashlib
import unittest

from check_configuration import matches_evidence_hash


class EvidenceHashTests(unittest.TestCase):
    def test_lf_checkout_matches_historical_crlf_hash(self):
        historical = b'{\r\n  "status": "PARTIAL"\r\n}\r\n'
        expected = hashlib.sha256(historical).hexdigest()
        self.assertTrue(matches_evidence_hash(historical, expected))
        self.assertTrue(matches_evidence_hash(historical.replace(b"\r\n", b"\n"), expected))

    def test_crlf_checkout_matches_historical_lf_hash(self):
        historical = b'{\n  "status": "PARTIAL"\n}\n'
        expected = hashlib.sha256(historical).hexdigest()
        self.assertTrue(matches_evidence_hash(historical, expected))
        self.assertTrue(matches_evidence_hash(historical.replace(b"\n", b"\r\n"), expected))

    def test_content_and_other_whitespace_changes_fail(self):
        historical = b'{\r\n  "status": "PARTIAL"\r\n}\r\n'
        expected = hashlib.sha256(historical).hexdigest()
        for changed in (
            historical.replace(b"PARTIAL", b"COMPLETE"),
            historical.replace(b"  ", b" "),
            historical.rstrip(b"\r\n"),
            historical + b"\r\n",
        ):
            with self.subTest(changed=changed):
                self.assertFalse(matches_evidence_hash(changed, expected))


if __name__ == "__main__":
    unittest.main()
