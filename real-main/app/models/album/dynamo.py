from collections import defaultdict
from datetime import datetime
import logging

from boto3.dynamodb.conditions import Key

from app.lib import datetime as real_datetime

logger = logging.getLogger()


class AlbumDynamo:

    def __init__(self, dynamo_client):
        self.client = dynamo_client

    def get_album(self, album_id, strongly_consistent=False):
        return self.client.get_item({
            'partitionKey': f'album/{album_id}',
            'sortKey': '-',
        }, strongly_consistent=strongly_consistent)

    def transact_add_album(self, album_id, user_id, name, description=None, created_at=None):
        created_at = created_at or datetime.utcnow()
        created_at_str = real_datetime.serialize(created_at)
        query_kwargs = {'Put': {
            'Item': {
                'schemaVersion': {'N': '0'},
                'partitionKey': {'S': f'album/{album_id}'},
                'sortKey': {'S': '-'},
                'gsiA1PartitionKey': {'S': f'album/{user_id}'},
                'gsiA1SortKey': {'S': created_at_str},
                'albumId': {'S': album_id},
                'ownedByUserId': {'S': user_id},
                'createdAt': {'S': created_at_str},
                'name': {'S': name},
            },
            'ConditionExpression': 'attribute_not_exists(partitionKey)',  # no updates, just adds
        }}
        if description is not None:
            query_kwargs['Put']['Item']['description'] = {'S': description}
        return query_kwargs

    def set(self, album_id, name=None, description=None):
        assert name is not None or description is not None, 'Action-less post edit requested'
        assert name != '', 'All albums must have names'

        exp_actions = defaultdict(list)
        exp_values = {}
        exp_names = {}

        if name is not None:
            exp_actions['SET'].append('#name = :name')
            exp_names['#name'] = 'name'
            exp_values[':name'] = name

        if description is not None:
            # empty string deletes
            if description == '':
                exp_actions['REMOVE'].append('description')
            else:
                exp_actions['SET'].append('description = :description')
                exp_values[':description'] = description

        update_query_kwargs = {
            'Key': {
                'partitionKey': f'album/{album_id}',
                'sortKey': '-',
            },
            'UpdateExpression': ' '.join([f'{k} {", ".join(v)}' for k, v in exp_actions.items()]),
        }
        if exp_names:
            update_query_kwargs['ExpressionAttributeNames'] = exp_names
        if exp_values:
            update_query_kwargs['ExpressionAttributeValues'] = exp_values
        return self.client.update_item(update_query_kwargs)

    def transact_delete_album(self, album_id):
        return {'Delete': {
            'Key': {
                'partitionKey': {'S': f'album/{album_id}'},
                'sortKey': {'S': '-'},
            },
            'ConditionExpression': 'attribute_exists(partitionKey)',
        }}

    def transact_add_post(self, album_id, now=None):
        "Transaction to change album properties to reflect adding a post to the album"
        now = now or datetime.utcnow()
        return {'Update': {
            'Key': {
                'partitionKey': {'S': f'album/{album_id}'},
                'sortKey': {'S': '-'},
            },
            'UpdateExpression': 'ADD postCount :one SET postsLastUpdatedAt = :now',
            'ExpressionAttributeValues': {
                ':one': {'N': '1'},
                ':now': {'S': real_datetime.serialize(now)},
            },
            'ConditionExpression': 'attribute_exists(partitionKey)',
        }}

    def transact_remove_post(self, album_id, now=None):
        "Transaction to change album properties to reflect removing a post from the album"
        now = now or datetime.utcnow()
        return {'Update': {
            'Key': {
                'partitionKey': {'S': f'album/{album_id}'},
                'sortKey': {'S': '-'},
            },
            'UpdateExpression': 'ADD postCount :negative_one SET postsLastUpdatedAt = :now',
            'ExpressionAttributeValues': {
                ':negative_one': {'N': '-1'},
                ':now': {'S': real_datetime.serialize(now)},
                ':zero': {'N': '0'},
            },
            'ConditionExpression': 'attribute_exists(partitionKey) and postCount > :zero',
        }}

    def generate_by_user(self, user_id):
        query_kwargs = {
            'KeyConditionExpression': Key('gsiA1PartitionKey').eq(f'album/{user_id}'),
            'IndexName': 'GSI-A1',
        }
        return self.client.generate_all_query(query_kwargs)