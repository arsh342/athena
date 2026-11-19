<?php
preg_replace('/x/e', 'strtoupper(\\0)', $s); // EXPECT php-hardening.preg-replace-eval
if (md5($pass) == $stored) { echo 1; } // EXPECT php-hardening.loose-hash-compare
