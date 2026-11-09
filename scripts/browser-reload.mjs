/** Wait for the new document, then the city DOM; Page.reload acknowledges before navigation completes. */
export async function reloadCity({command,waitEvent,evaluate,until}) {
  const loaded=waitEvent('Page.loadEventFired');
  await command('Page.reload');
  await loaded;
  await until(()=>evaluate("Boolean(document.getElementById('city-state')?.textContent?.includes('agents') && document.querySelector('#agent-list [data-agent]'))"),
    'Reloaded city did not render Agent controls');
}
