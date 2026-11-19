use std::collections::HashMap;

/// Counts words in the text.
pub fn word_count(text: &str) -> HashMap<String, usize> {
    let mut map = HashMap::new();
    for w in text.split_whitespace() {
        *map.entry(w.to_string()).or_insert(0) += 1;
    }
    map
}

pub struct Stack {
    items: Vec<i32>,
    limit: usize,
}

impl Stack {
    pub fn push(&mut self, v: i32) -> bool {
        if self.items.len() >= self.limit {
            return false;
        }
        self.items.push(v);
        true
    }

    pub fn pop(&mut self) -> Option<i32> {
        let top = self.items.pop();
        top
    }
}

fn outer(values: &[i32]) -> i32 {
    /* block comment */

    fn inner(x: i32) -> i32 {
        let y = x + 1;
        y
    }
    let add = |a: i32, b: i32| {
        let s = a + b;
        s
    };
    values.iter().map(|v| inner(*v)).fold(0, add)
}
