import { useState } from 'react';

const ICONS_SHOWN = 3;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The site's own favicon, loaded straight from the site; its first letter when it has none. */
function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="favicon" title={host}>
      {failed ? host.charAt(0).toUpperCase() : <img src={`https://${host}/favicon.ico`} alt="" onError={() => setFailed(true)} />}
    </span>
  );
}

/** Pages a participant opened: collapsed to a few site icons, expandable to every page. */
export function Sources({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState(false);
  if (!urls.length) return null;
  const hosts = [...new Set(urls.map(hostOf))];
  const more = hosts.length - ICONS_SHOWN;
  return (
    <div className="sources">
      <button className="ghost sources-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>Sources</span>
        <span className="favicon-stack">
          {hosts.slice(0, ICONS_SHOWN).map((h) => <Favicon key={h} host={h} />)}
        </span>
        {more > 0 && <span className="sources-more">+ {more} more</span>}
      </button>
      {open && (
        <ul className="sources-list">
          {urls.map((u) => (
            <li key={u}>
              <Favicon host={hostOf(u)} />
              <a href={u} target="_blank" rel="noreferrer noopener">{u.replace(/^https?:\/\/(www\.)?/, '')}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
