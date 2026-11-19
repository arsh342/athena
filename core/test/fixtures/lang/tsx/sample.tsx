import React from 'react';

/** Greets the user. */
export function Greeting({ name }: { name: string }) {
  const text = `Hello ${name}`;
  return <p>{text}</p>;
}

export class Panel extends React.Component<{ title: string }> {
  handleClick() {
    console.log(this.props.title);
    return true;
  }

  render() {
    return <div onClick={() => this.handleClick()}>{this.props.title}</div>;
  }
}

export const List = ({ items }: { items: string[] }) => {
  const rows = items.map((item) => <li key={item}>{item}</li>);
  return <ul>{rows}</ul>;
};

function Outer() {
  // nested helper
  function label(n: number) {
    const s = String(n);
    return s;
  }
  return label(1);
}
