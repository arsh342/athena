<?php
preg_replace_callback('/x/', fn($m) => strtoupper($m[0]), $s);
if (hash_equals($stored, hash('sha256', $pass))) { echo 1; }
