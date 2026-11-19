#!/bin/bash
set -euo pipefail
name="release"
eval "echo $name"
curl --fail -o out.tar.gz "https://example.com/$name.tar.gz"
sha256sum -c checksums.txt
chmod 755 /var/www
rm -rf "${BUILD_DIR:?}/"
