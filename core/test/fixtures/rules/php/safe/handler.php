<?php
function handle($pdo) {
  $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
  $stmt->execute([$_GET['id']]);
  $id = intval($_GET['id']);
  mysqli_query($conn, "SELECT * FROM t WHERE n = " . $id);
  system("ping " . escapeshellarg($_GET['host']));
  echo "<h1>" . htmlspecialchars($_GET['name']) . "</h1>";
  header("Location: /home");
  $f = file_get_contents(basename($_GET['f']));
  include 'header.php';
}

function store($password) {
  return password_hash($password, PASSWORD_ARGON2ID);
}

function checksum($data) {
  return md5($data);
}

function token() {
  return bin2hex(random_bytes(32));
}
