using Microsoft.EntityFrameworkCore;
class Repo {
  void F(DbContext db, string col) {
    db.Users.FromSqlRaw("SELECT * FROM Users ORDER BY " + col); // EXPECT efcore.raw-sql-concat
  }
}
