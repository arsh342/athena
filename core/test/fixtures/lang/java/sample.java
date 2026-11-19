import java.util.List;

class Inventory {
    private final List<String> items;

    /**
     * Creates an inventory.
     */
    Inventory(List<String> items) {
        this.items = items;
        System.out.println("created");
    }

    int count(String prefix) {
        int total = 0;
        for (String item : items) {
            if (item.startsWith(prefix) || prefix.isEmpty()) {
                total++;
            }
        }
        return total;
    }

    Runnable printer() {
        // comment block
        // explaining the lambda

        Runnable r = () -> {
            System.out.println(items);
            System.out.println(items.size());
        };
        return r;
    }
}

interface Named {
    String name();
    default String greet() { return "hi " + name(); }
}
