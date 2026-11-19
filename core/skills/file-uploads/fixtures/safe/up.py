import os
from werkzeug.utils import secure_filename
@app.route('/up', methods=['POST'])
def up():
    f = request.files['f']
    f.save(os.path.join(UPLOAD_DIR, secure_filename(f.filename)))
