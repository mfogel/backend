from io import BytesIO
from os import path

from PIL import Image
import pytest

from app.models.post.enums import PostStatus, PostType
from app.models.post.exceptions import PostException
from app.utils import image_size

grant_rotated_width = grant_height = 320
grant_rotated_height = grant_width = 240
grant_path = path.join(path.dirname(__file__), '..', '..', 'fixtures', 'grant.jpg')
grant_rotated_path = path.join(path.dirname(__file__), '..', '..', 'fixtures', 'grant-rotated.jpg')
blank_path = path.join(path.dirname(__file__), '..', '..', 'fixtures', 'big-blank.jpg')


@pytest.fixture
def processing_image_post(post_manager):
    post = post_manager.add_post('uid', 'pid', PostType.IMAGE)
    transacts = [post.dynamo.transact_set_post_status(post.item, PostStatus.PROCESSING)]
    post.dynamo.client.transact_write_items(transacts)
    yield post.refresh_item()


def test_build_image_thumbnails_not_jpeg_data(s3_uploads_client, processing_image_post):
    post = processing_image_post

    # put something that isn't jpeg data in the bucket
    path = post.get_image_path(image_size.NATIVE)
    s3_uploads_client.put_object(path, b'aintnojpeg', 'image/jpeg')

    with pytest.raises(PostException, match='Unable to decode native image data as jpeg'):
        post.build_image_thumbnails()


def test_build_image_thumbnails_wide_image(s3_uploads_client, processing_image_post):
    post = processing_image_post

    # put an image in the bucket
    path = post.get_image_path(image_size.NATIVE)
    s3_uploads_client.put_object(path, open(blank_path, 'rb'), 'image/jpeg')

    post.build_image_thumbnails()

    # check the 4k thumbnail is there, and that it is the right size
    path_4k = post.get_image_path(image_size.K4)
    assert s3_uploads_client.exists(path_4k)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_4k))
    width, height = image.size
    assert width == 3840
    assert height < 2160

    # check the 1080 thumbnail is there, and that it is the right size
    path_1080 = post.get_image_path(image_size.P1080)
    assert s3_uploads_client.exists(path_1080)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_1080))
    width, height = image.size
    assert width == 1920
    assert height < 1080

    # check the 480 thumbnail is there, and that it is the right size
    path_480 = post.get_image_path(image_size.P480)
    assert s3_uploads_client.exists(path_480)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_480))
    width, height = image.size
    assert width == 854
    assert height < 480

    # check the 64 thumbnail is there, and that it is the right size
    path_64 = post.get_image_path(image_size.P64)
    assert s3_uploads_client.exists(path_64)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_64))
    width, height = image.size
    assert width == 114
    assert height < 64


def test_build_image_thumbnails_tall_image(s3_uploads_client, processing_image_post):
    post = processing_image_post

    # rotate our wide image to make it tall
    image = Image.open(blank_path).rotate(90, expand=True)
    in_mem_file = BytesIO()
    image.save(in_mem_file, format='JPEG')
    in_mem_file.seek(0)

    # put an image in the bucket
    path = post.get_image_path(image_size.NATIVE)
    s3_uploads_client.put_object(path, in_mem_file, 'image/jpeg')

    post.build_image_thumbnails()

    # check the 4k thumbnail is there, and that it is the right size
    path_4k = post.get_image_path(image_size.K4)
    assert s3_uploads_client.exists(path_4k)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_4k))
    width, height = image.size
    assert width < 3840
    assert height == 2160

    # check the 1080 thumbnail is there, and that it is the right size
    path_1080 = post.get_image_path(image_size.P1080)
    assert s3_uploads_client.exists(path_1080)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_1080))
    width, height = image.size
    assert width < 1920
    assert height == 1080

    # check the 480 thumbnail is there, and that it is the right size
    path_480 = post.get_image_path(image_size.P480)
    assert s3_uploads_client.exists(path_480)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_480))
    width, height = image.size
    assert width < 854
    assert height == 480

    # check the 64 thumbnail is there, and that it is the right size
    path_64 = post.get_image_path(image_size.P64)
    assert s3_uploads_client.exists(path_64)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_64))
    width, height = image.size
    assert width < 114
    assert height == 64


@pytest.mark.filterwarnings("ignore:Metadata Warning, tag .* had too many entries.*:UserWarning")
def test_build_image_thumbnails_respect_exif_orientation(s3_uploads_client, processing_image_post):
    post = processing_image_post

    # put an image in the bucket
    path = post.get_image_path(image_size.NATIVE)
    s3_uploads_client.put_object(path, open(grant_rotated_path, 'rb'), 'image/jpeg')

    post.build_image_thumbnails()

    # check that the thumbnailing process respected the exif orientation tag,
    # by looking at width and height of output image

    # check 4k
    path_4k = post.get_image_path(image_size.K4)
    assert s3_uploads_client.exists(path_4k)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_4k))
    width, height = image.size
    assert width == grant_rotated_width
    assert height == grant_rotated_height

    # check 1080p
    path_1080 = post.get_image_path(image_size.P1080)
    assert s3_uploads_client.exists(path_1080)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_1080))
    width, height = image.size
    assert width == grant_rotated_width
    assert height == grant_rotated_height

    # check 480p
    path_480 = post.get_image_path(image_size.P480)
    assert s3_uploads_client.exists(path_480)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_480))
    width, height = image.size
    assert width == grant_rotated_width
    assert height == grant_rotated_height

    # check 64p
    path_64 = post.get_image_path(image_size.P64)
    assert s3_uploads_client.exists(path_64)
    image = Image.open(s3_uploads_client.get_object_data_stream(path_64))
    width, height = image.size
    assert width < grant_rotated_width
    assert height < grant_rotated_height
    assert width < 114
    assert height == 64


def test_build_image_thumbnails_content_type(s3_uploads_client, processing_image_post):
    post = processing_image_post

    # put an image in the bucket
    path = post.get_image_path(image_size.NATIVE)
    s3_uploads_client.put_object(path, open(blank_path, 'rb'), 'image/jpeg')

    post.build_image_thumbnails()

    # check the height and width of the thumbnails to make sure the
    # thumbnailing process correctly accounted for the exif orientation header

    # check 4k content type
    path_4k = post.get_image_path(image_size.K4)
    assert s3_uploads_client.bucket.Object(path_4k).content_type == 'image/jpeg'

    # check 1080p content type
    path_1080 = post.get_image_path(image_size.P1080)
    assert s3_uploads_client.bucket.Object(path_1080).content_type == 'image/jpeg'

    # check 480p content type
    path_480 = post.get_image_path(image_size.P480)
    assert s3_uploads_client.bucket.Object(path_480).content_type == 'image/jpeg'

    # check 64p content type
    path_64 = post.get_image_path(image_size.P64)
    assert s3_uploads_client.bucket.Object(path_64).content_type == 'image/jpeg'