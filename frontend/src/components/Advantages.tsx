export interface Advantage { title: string; body: string }

function Check() {
  return (
    <svg className="adv-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** A badge, a heading and lede, then a grid of ticked advantages. */
export function Advantages({ badge, title, lede, items }: { badge: string; title: string; lede: string; items: readonly Advantage[] }) {
  return (
    <section className="section adv" id="principles">
      <div className="adv-head">
        <span className="adv-badge">{badge}</span>
        <h2>{title}</h2>
        <p>{lede}</p>
      </div>
      <ul className="adv-grid">
        {items.map((item) => (
          <li className="adv-item" key={item.title}>
            <Check />
            <div>
              <p className="adv-title">{item.title}</p>
              <p className="adv-body">{item.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
