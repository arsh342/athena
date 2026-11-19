/** Formats a user name. */
export function formatName(first: string, last: string): string {
  const full = `${first} ${last}`;
  return full.trim();
}

interface Shape {
  area(): number;
  name: string;
}

class Square implements Shape {
  name = 'square';
  constructor(private side: number) {
    this.side = side;
  }

  area(): number {
    return this.side > 0 ? this.side * this.side : 0;
  }
}

const toUpper = (value: string): string => {
  const upper = value.toUpperCase();
  return upper;
};

function wrap(items: string[]): string[] {
  /*
   * Block comment inside wrap.
   */
  function each(item: string): string {
    return `[${item}]`;
  }
  return items.map(each);
}
