from django.views.decorators.csrf import csrf_exempt
@csrf_exempt  # EXPECT django.csrf-exempt
def hook(request):
    return None
