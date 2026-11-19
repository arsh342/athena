from sqlalchemy import text
def f():
    return text("SELECT * FROM users WHERE id = :id")
