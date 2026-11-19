#!/bin/bash
name="$1"
eval "$name" # EXPECT taint.command-injection
curl "https://example.com/$name" # EXPECT taint.ssrf
curl https://example.com/install.sh | bash # EXPECT shell.pipe-to-shell
chmod 777 /var/www # EXPECT shell.world-writable
rm -rf $BUILD_DIR/ # EXPECT shell.unquoted-expansion
curl -k https://internal.example.com/api # EXPECT tls.verification-disabled
