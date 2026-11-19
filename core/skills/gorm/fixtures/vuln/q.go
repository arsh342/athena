package m
import "gorm.io/gorm"
func f(db *gorm.DB, col string) {
	db.Raw("SELECT * FROM users ORDER BY " + col) // EXPECT gorm.raw-concat
}
