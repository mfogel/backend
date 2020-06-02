import json
import os

import boto3

CLOUDFRONT_KEY_PAIR_NAME = os.environ.get('SECRETSMANAGER_CLOUDFRONT_KEY_PAIR_NAME')
POST_VERIFICATION_API_CREDS_NAME = os.environ.get('SECRETSMANAGER_POST_VERIFICATION_API_CREDS_NAME')
GOOGLE_CLIENT_IDS_NAME = os.environ.get('SECRETSMANAGER_GOOGLE_CLIENT_IDS_NAME')


class SecretsManagerClient:
    def __init__(
        self,
        cloudfront_key_pair_name=CLOUDFRONT_KEY_PAIR_NAME,
        post_verification_api_creds_name=POST_VERIFICATION_API_CREDS_NAME,
        google_client_ids_name=GOOGLE_CLIENT_IDS_NAME,
    ):
        self.boto_client = boto3.client('secretsmanager')
        self.exceptions = self.boto_client.exceptions
        self.cloudfront_key_pair_name = cloudfront_key_pair_name
        self.post_verification_api_creds_name = post_verification_api_creds_name
        self.google_client_ids_name = google_client_ids_name

    def get_cloudfront_key_pair(self):
        if not hasattr(self, '_cloudfront_key_pair'):
            resp = self.boto_client.get_secret_value(SecretId=self.cloudfront_key_pair_name)
            self._cloudfront_key_pair = json.loads(resp['SecretString'])
        return self._cloudfront_key_pair

    def get_post_verification_api_creds(self):
        if not hasattr(self, '_post_verification_api_creds'):
            resp = self.boto_client.get_secret_value(SecretId=self.post_verification_api_creds_name)
            self._post_verification_api_creds = json.loads(resp['SecretString'])
        return self._post_verification_api_creds

    def get_google_client_ids(self):
        if not hasattr(self, '_google_client_ids'):
            resp = self.boto_client.get_secret_value(SecretId=self.google_client_ids_name)
            self._google_client_ids = json.loads(resp['SecretString'])
        return self._google_client_ids
