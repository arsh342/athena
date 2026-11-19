<?php
function handle() {
  $id = $_GET['id'];
  mysqli_query($conn, "SELECT * FROM users WHERE id = " . $id); // EXPECT taint.sql-injection
  system("ping " . $_GET['host']); // EXPECT taint.command-injection
  include $_GET['page']; // EXPECT taint.file-include
  echo "<h1>" . $_GET['name'] . "</h1>"; // EXPECT taint.xss
  header("Location: " . $_GET['next']); // EXPECT taint.open-redirect
  unserialize($_COOKIE['data']); // EXPECT taint.deserialization
  file_get_contents($_GET['f']); // EXPECT taint.path-traversal
  extract($_POST); // EXPECT php.dangerous-extract
}

function store($password) {
  return md5($password); // EXPECT crypto.weak-hash
}

function resetToken() {
  $resetToken = rand(); // EXPECT crypto.insecure-random
  return $resetToken;
}
