package main

import (
	"crypto/tls"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"crypto/md5"
)

func handler(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	db.Query("SELECT * FROM users WHERE id = " + id) // EXPECT taint.sql-injection
	exec.Command("sh", "-c", r.FormValue("cmd")).Run() // EXPECT taint.command-injection
	os.Open("/data/" + id) // EXPECT taint.path-traversal
	http.Get(r.FormValue("u")) // EXPECT taint.ssrf
	http.Redirect(w, r, r.FormValue("next"), 302) // EXPECT taint.open-redirect
	fmt.Fprintf(w, "<h1>%s</h1>", id) // EXPECT taint.xss
}

func hashPassword(password string) [16]byte {
	return md5.Sum([]byte(password)) // EXPECT crypto.weak-hash
}

func resetToken() int {
	resetToken := rand.Intn(999999) // EXPECT crypto.insecure-random
	return resetToken
}

var cfg = &tls.Config{InsecureSkipVerify: true} // EXPECT tls.verification-disabled
