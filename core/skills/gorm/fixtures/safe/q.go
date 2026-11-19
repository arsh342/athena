package m
import "gorm.io/gorm"
func f(db *gorm.DB, id int) {
	db.Where("id = ?", id)
}
