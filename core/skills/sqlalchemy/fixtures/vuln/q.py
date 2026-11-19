from sqlalchemy import text
def f(table):
    return text(f"SELECT * FROM {table}")  # EXPECT sqlalchemy.text-concat
