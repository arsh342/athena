using Microsoft.EntityFrameworkCore;
class Repo {
  void F(DbContext db, int id) {
    db.Users.FromSqlInterpolated($"SELECT * FROM Users WHERE Id = {id}");
  }
}
