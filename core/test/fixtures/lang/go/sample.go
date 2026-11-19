package sample

import "fmt"

// Greet returns a greeting.
func Greet(name string) string {
    msg := "hello " + name
    return msg
}

type Account struct {
    Owner   string
    Balance int
}

func (a *Account) Deposit(amount int) {
    if amount > 0 {
        a.Balance += amount
    }
}

func (a *Account) String() string {
    s := fmt.Sprintf("%s:%d", a.Owner, a.Balance)
    return s
}

func Process(items []int) int {
    /* block comment
       inside Process */

    double := func(x int) int {
        y := x * 2
        return y
    }
    total := 0
    for _, it := range items {
        total += double(it)
    }
    return total
}
