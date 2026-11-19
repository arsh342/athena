export const A = () => <a href="https://x.test" target="_blank">x</a>; // EXPECT react.target-blank-no-rel
export const B = () => <a href="javascript:alert(1)">y</a>; // EXPECT react.javascript-url
