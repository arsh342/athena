package main
import (
	"net/http"
	"time"
	"path/filepath"
)
func main() {
	srv := &http.Server{Addr: ":8080", ReadHeaderTimeout: 5 * time.Second}
	srv.ListenAndServe()
}
func h(c *gin.Context) {
	c.File(filepath.Base(c.Query("f")))
}
