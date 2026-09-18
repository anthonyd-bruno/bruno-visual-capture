export type Section = 'capture' | 'workflows' | 'library' | 'settings' | 'run';

export function Nav({ current }: { current: Section }) {
  const items: Array<[Section, string]> = [['capture', 'Capture'], ['workflows', 'Workflows'], ['library', 'Library'], ['settings', 'Settings']];
  return (
    <nav>
      <div className="brand">Bruno Capture</div>
      {items.map(([id, label]) => (
        <a key={id} href={`#/${id}`} className={current === id || (id === 'library' && current === 'run') ? 'active' : ''}>{label}</a>
      ))}
    </nav>
  );
}
