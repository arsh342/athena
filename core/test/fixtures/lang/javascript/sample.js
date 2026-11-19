/**
 * Adds two numbers.
 */
function add(a, b) {
  const sum = a + b;
  return sum;
}

class Counter {
  constructor(start) {
    this.value = start;
    this.step = 1;
  }

  increment(by) {
    if (by > 0 && by < 100) {
      this.value += by;
    }
    return this.value;
  }
}

const double = (n) => {
  const result = n * 2;
  return result;
};

function outer(items) {
  // helper that is nested inside outer
  // it filters values
  function inner(x) {
    const ok = x > 1;
    return ok;
  }
  return items.filter(inner);
}

const tiny = (x) => x + 1;
