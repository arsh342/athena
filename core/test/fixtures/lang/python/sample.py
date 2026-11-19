import os


def load_config(path, default=None):
    """Load the configuration file."""
    if not os.path.exists(path):
        return default
    with open(path) as handle:
        return handle.read()


class Repository:
    def __init__(self, root):
        self.root = root
        self.items = []

    @property
    def size(self):
        count = len(self.items)
        return count


handler = (lambda value:
           value * 2
           if value
           else 0)


def outer(values):
    # comment block
    # describing the nested helper

    def inner(x):
        y = x + 1
        return y
    return [inner(v) for v in values]


short = lambda x: x
