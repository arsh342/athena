def f(user):
    if not user.is_admin:
        raise PermissionError('admin only')
