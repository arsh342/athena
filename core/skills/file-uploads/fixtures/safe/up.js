const multer = require('multer');
const up = multer({ dest: 'u/', limits: { fileSize: 1000000 } });
function target() {
  return path.join('uploads', crypto.randomUUID());
}
