package main

import (
	"crypto/md5"
	"crypto/rand"
	"fmt"
	"html"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

func handler(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	db.Query("SELECT * FROM users WHERE id = $1", id)
	n, _ := strconv.Atoi(r.FormValue("n"))
	db.Query("SELECT * FROM t WHERE n = " + strconv.Itoa(n))
	exec.Command("ping", "-c", "1", r.FormValue("host")).Run()
	os.Open(filepath.Base(id))
	http.Redirect(w, r, "/home", 302)
	fmt.Fprintf(w, "<h1>%s</h1>", html.EscapeString(id))
	fmt.Fprintf(os.Stderr, "request for %s\n", id)
}

func checksum(b []byte) [16]byte {
	return md5.Sum(b)
}

func token() []byte {
	b := make([]byte, 32)
	rand.Read(b)
	return b
}
