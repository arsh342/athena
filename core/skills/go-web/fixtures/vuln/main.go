package main
import "net/http"
func main() {
	http.ListenAndServe(":8080", nil) // EXPECT go-web.listen-without-timeouts
}
func h(c *gin.Context) {
	c.File(c.Query("f")) // EXPECT taint.path-traversal
}
