#include <vector>

/// Squares a value.
int square(int v) {
    return v * v;
}

class Stack {
public:
    void push(int value) {
        items.push_back(value);
        size++;
    }

    int pop() {
        int top = items.back();
        items.pop_back();
        return top;
    }

private:
    std::vector<int> items;
    int size = 0;
};

int stack_total(const std::vector<int>& xs) {
    // comment block

    auto add = [&](int a, int b) {
        return a + b;
    };
    int t = 0;
    for (int x : xs) t = add(t, x);
    return t;
}
