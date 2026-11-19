const multer = require('multer');
const up = multer({ dest: 'u/' }); // EXPECT file-uploads.multer-no-limits
function target(file) {
  return path.join('uploads', file.originalname); // EXPECT file-uploads.original-name-in-path
}
