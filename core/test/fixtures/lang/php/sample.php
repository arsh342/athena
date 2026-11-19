<?php

/**
 * Formats a price.
 */
function format_price($amount, $currency = 'USD')
{
    return sprintf('%.2f %s', $amount, $currency);
}

class Cart
{
    private array $items = [];

    public function add(string $name, int $qty): void
    {
        if ($qty > 0 && $name !== '') {
            $this->items[$name] = $qty;
        }
    }

    public function total(): int
    {
        return array_sum($this->items);
    }
}

$double = function ($x) {
    $y = $x * 2;
    return $y;
};

function outer($values)
{
    // comment block
    // about the nested function

    function inner_helper($v) {
        return $v + 1;
    }
    return array_map('inner_helper', $values);
}
