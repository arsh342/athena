import os
@app.route('/up', methods=['POST'])
def up():
    f = request.files['f']
    f.save(os.path.join(UPLOAD_DIR, f.filename))  # EXPECT taint.path-traversal
