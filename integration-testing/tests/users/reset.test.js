/* eslint-env jest */

const path = require('path')
const uuidv4 = require('uuid/v4')

const cognito = require('../../utils/cognito.js')
const misc = require('../../utils/misc.js')
const schema = require('../../utils/schema.js')

const grantPath = path.join(__dirname, '..', '..', 'fixtures', 'grant.jpg')
const grantContentType = 'image/jpeg'

const AuthFlow = cognito.AuthFlow

const loginCache = new cognito.AppSyncLoginCache()

beforeAll(async () => {
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
})

beforeEach(async () => await loginCache.clean())
afterAll(async () => await loginCache.clean())


test("resetUser really releases the user's username", async () => {
  const [ourClient, ourUserId, ourPassword] = await loginCache.getCleanLogin()
  const [theirClient, , theirPassword] = await loginCache.getCleanLogin()

  // set our username
  const ourUsername = cognito.generateUsername()
  let resp = await ourClient.mutate({mutation: schema.setUsername, variables: {username: ourUsername}})
  expect(resp['errors']).toBeUndefined()

  // verify we can login using our username
  let AuthParameters = {USERNAME: ourUsername.toLowerCase(), PASSWORD: ourPassword}
  resp = await cognito.userPoolClient.initiateAuth({AuthFlow, AuthParameters}).promise()
  expect(resp).toHaveProperty('AuthenticationResult.AccessToken')

  // verify someone else cannot claim our username or variants of
  await expect(theirClient.mutate({
    mutation: schema.setUsername,
    variables: {username: ourUsername}
  })).rejects.toBeDefined()
  await expect(theirClient.mutate({
    mutation: schema.setUsername,
    variables: {username: ourUsername.toUpperCase()}
  })).rejects.toBeDefined()

  // reset our account
  resp = await ourClient.mutate({mutation: schema.resetUser})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['resetUser']['userId']).toBe(ourUserId)

  // verify we cannot login with our username anymore
  AuthParameters = {USERNAME: ourUsername.toLowerCase(), PASSWORD: ourPassword}
  await expect(cognito.userPoolClient.initiateAuth({AuthFlow, AuthParameters}).promise()).rejects.toBeDefined()

  // verify that someone else can now claim our released username and then login with it
  await theirClient.mutate({
    mutation: schema.setUsername,
    variables: {username: ourUsername}
  })
  AuthParameters = {USERNAME: ourUsername.toLowerCase(), PASSWORD: theirPassword}
  resp = await cognito.userPoolClient.initiateAuth({AuthFlow, AuthParameters}).promise()
  expect(resp).toHaveProperty('AuthenticationResult.AccessToken')
})


test("resetUser deletes all the user's data (best effort test)", async () => {
  // Note that without privileged access to the system's state,
  // we can't completely verify this. As such this is a best-effort test.

  // create us and another user
  const [ourClient, ourUserId] = await loginCache.getCleanLogin()
  const [theirClient, theirUserId] = await loginCache.getCleanLogin()

  // they follow us, we follow them
  let resp = await ourClient.mutate({mutation: schema.followUser, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['followUser']['followedStatus']).toBe('FOLLOWING')
  resp = await theirClient.mutate({mutation: schema.followUser, variables: {userId: ourUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['followUser']['followedStatus']).toBe('FOLLOWING')

  // we add a text only post, never expires
  resp = await ourClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId: uuidv4(), text: 'je ne'}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addPost']['postStatus']).toBe('COMPLETED')

  // we add a text only post that is also a story
  resp = await ourClient.mutate({
    mutation: schema.addTextOnlyPost,
    variables: {postId: uuidv4(), text: 'yo no se', lifetime: 'P1D'}
  })
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addPost']['postStatus']).toBe('COMPLETED')

  // we add a media post that is also a story
  resp = await ourClient.mutate({
    mutation: schema.addOneMediaPost,
    variables: {postId: uuidv4(), mediaId: uuidv4(), mediaType: 'IMAGE', lifetime: 'P1D'},
  })
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addPost']['postStatus']).toBe('PENDING')
  expect(resp['data']['addPost']['mediaObjects']).toHaveLength(1)
  expect(resp['data']['addPost']['mediaObjects'][0]['mediaStatus']).toBe('AWAITING_UPLOAD')
  const mediaId = resp['data']['addPost']['mediaObjects'][0]['mediaId']
  const uploadUrl = resp['data']['addPost']['mediaObjects'][0]['uploadUrl']
  await misc.uploadMedia(grantPath, grantContentType, uploadUrl)
  await misc.sleep(2000)

  // verify they see us as a followed and a follower
  resp = await theirClient.query({query: schema.ourFollowedUsers})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['followedUsers']['items']).toHaveLength(1)
  expect(resp['data']['self']['followedUsers']['items'][0]['userId']).toBe(ourUserId)
  resp = await theirClient.query({query: schema.ourFollowerUsers})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['followerUsers']['items']).toHaveLength(1)
  expect(resp['data']['self']['followerUsers']['items'][0]['userId']).toBe(ourUserId)

  // verify they see our posts, media objects
  resp = await theirClient.query({query: schema.getPosts, variables: {userId: ourUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getPosts']['items']).toHaveLength(3)
  expect(resp['data']['getPosts']['items'][0]['postedBy']['userId']).toBe(ourUserId)
  expect(resp['data']['getPosts']['items'][1]['postedBy']['userId']).toBe(ourUserId)
  expect(resp['data']['getPosts']['items'][2]['postedBy']['userId']).toBe(ourUserId)
  resp = await theirClient.query({query: schema.getMediaObjects, variables: {userId: ourUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getMediaObjects']['items']).toHaveLength(1)
  expect(resp['data']['getMediaObjects']['items'][0]['mediaId']).toBe(mediaId)

  // verify they see our stories
  resp = await theirClient.query({query: schema.getFollowedUsersWithStories})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getFollowedUsersWithStories']['items']).toHaveLength(1)
  expect(resp['data']['getFollowedUsersWithStories']['items'][0]['userId']).toBe(ourUserId)
  resp = await theirClient.query({query: schema.getStories, variables: {userId: ourUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getStories']['items']).toHaveLength(2)
  expect(resp['data']['getStories']['items'][0]['postedBy']['userId']).toBe(ourUserId)
  expect(resp['data']['getStories']['items'][1]['postedBy']['userId']).toBe(ourUserId)

  // verify our posts show up in their feed
  resp = await theirClient.query({query: schema.getFeed})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getFeed']['items']).toHaveLength(3)
  expect(resp['data']['getFeed']['items'][0]['postedBy']['userId']).toBe(ourUserId)
  expect(resp['data']['getFeed']['items'][1]['postedBy']['userId']).toBe(ourUserId)
  expect(resp['data']['getFeed']['items'][2]['postedBy']['userId']).toBe(ourUserId)

  // we reset our account
  resp = await ourClient.mutate({mutation: schema.resetUser})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['resetUser']['userId']).toBe(ourUserId)

  // clear their client's cache
  await theirClient.resetStore()

  // verify they do not see us as a followed and a follower
  resp = await theirClient.query({query: schema.ourFollowedUsers})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['followedUsers']['items']).toHaveLength(0)
  resp = await theirClient.query({query: schema.ourFollowerUsers})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['followerUsers']['items']).toHaveLength(0)

  // verify they do not see our posts, media objects
  resp = await theirClient.query({query: schema.getPosts, variables: {userId: ourUserId}})
  expect(resp['errors'].length).toBeTruthy()
  expect(resp['data']).toBeNull()
  resp = await theirClient.query({query: schema.getMediaObjects, variables: {userId: ourUserId}})
  expect(resp['errors'].length).toBeTruthy()
  expect(resp['data']).toBeNull()

  // verify they do not see our stories
  resp = await theirClient.query({query: schema.getFollowedUsersWithStories})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getFollowedUsersWithStories']['items']).toHaveLength(0)
  resp = await theirClient.query({query: schema.getStories, variables: {userId: ourUserId}})
  expect(resp['errors'].length).toBeTruthy()
  expect(resp['data']).toBeNull()

  // verify our posts do not show up in their feed, stories
  resp = await theirClient.query({query: schema.getFeed})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getFeed']['items']).toHaveLength(0)
})


test('resetUser deletes any likes we have placed', async () => {
  const [ourClient, ourUserId] = await loginCache.getCleanLogin()
  const [theirClient] = await loginCache.getCleanLogin()

  // they add a post
  const postId = uuidv4()
  let resp = await theirClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId, text: 'je ne sais pas'}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addPost']['postStatus']).toBe('COMPLETED')

  // we like the post onymouly
  resp = await ourClient.mutate({mutation: schema.onymouslyLikePost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['onymouslyLikePost']['postId']).toBe(postId)

  // check the post for that like
  resp = await theirClient.query({query: schema.post, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['post']['onymousLikeCount']).toBe(1)
  expect(resp['data']['post']['onymouslyLikedBy']['items']).toHaveLength(1)
  expect(resp['data']['post']['onymouslyLikedBy']['items'][0]['userId']).toBe(ourUserId)

  // we reset our account
  resp = await ourClient.mutate({mutation: schema.resetUser})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['resetUser']['userId']).toBe(ourUserId)

  // clear their client's cache
  await theirClient.resetStore()

  // check the post no longer has that like
  resp = await theirClient.query({query: schema.post, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['post']['onymousLikeCount']).toBe(0)
  expect(resp['data']['post']['onymouslyLikedBy']['items']).toHaveLength(0)
})


test('resetUser deletes any likes on our posts', async () => {
  const [ourClient, ourUserId] = await loginCache.getCleanLogin()
  const [theirClient, theirUserId] = await loginCache.getCleanLogin()

  // we add a post
  const postId = uuidv4()
  let resp = await ourClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId, text: 'je ne sais pas'}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addPost']['postStatus']).toBe('COMPLETED')

  // they like the post onymouly
  resp = await theirClient.mutate({mutation: schema.onymouslyLikePost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['onymouslyLikePost']['postId']).toBe(postId)

  // check the list of onymous likers of the post
  resp = await theirClient.query({query: schema.post, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['post']['onymouslyLikedBy']['items']).toHaveLength(1)
  expect(resp['data']['post']['onymouslyLikedBy']['items'][0]['userId']).toBe(theirUserId)

  // check their list of onymously liked posts
  resp = await theirClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['onymouslyLikedPosts']['items']).toHaveLength(1)
  expect(resp['data']['self']['onymouslyLikedPosts']['items'][0]['postId']).toBe(postId)

  // we reset our account
  resp = await ourClient.mutate({mutation: schema.resetUser})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['resetUser']['userId']).toBe(ourUserId)

  // clear their client's cache
  await theirClient.resetStore()

  // check post is gone
  resp = await theirClient.query({query: schema.post, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['post']).toBeNull()

  // check their list of onymously liked posts
  resp = await theirClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['onymouslyLikedPosts']['items']).toHaveLength(0)
})


test('resetUser deletes all blocks of us and by us', async () => {
  // us and two other users
  const [ourClient, ourUserId, , , ourUsername] = await loginCache.getCleanLogin()
  const [, other1UserId] = await loginCache.getCleanLogin()
  const [other2Client] = await loginCache.getCleanLogin()

  // we block one of them, and the other one blocks us
  let resp = await ourClient.mutate({mutation: schema.blockUser, variables: {userId: other1UserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['blockUser']['userId']).toBe(other1UserId)

  resp = await other2Client.mutate({mutation: schema.blockUser, variables: {userId: ourUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['blockUser']['userId']).toBe(ourUserId)

  // verify those blocks show up
  resp = await ourClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['blockedUsers']['items']).toHaveLength(1)

  resp = await other2Client.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['blockedUsers']['items']).toHaveLength(1)

  // reset our user, and re-initialize
  resp = await ourClient.mutate({mutation: schema.resetUser, variables: {newUsername: ourUsername}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['resetUser']['userId']).toBe(ourUserId)

  // clear their client's cache
  await other2Client.resetStore()

  // verify both of the blocks have now disappeared
  resp = await ourClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['blockedUsers']['items']).toHaveLength(0)

  resp = await other2Client.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['blockedUsers']['items']).toHaveLength(0)
})


test('resetUser deletes users flags of posts', async () => {
  const [ourClient, , , , ourUsername] = await loginCache.getCleanLogin()
  const [theirClient] = await loginCache.getCleanLogin()

  // they add a post
  const postId = uuidv4()
  let resp = await theirClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId, text: 'lore ipsum'}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addPost']['postId']).toBe(postId)

  // we flag that post
  resp = await ourClient.mutate({mutation: schema.flagPost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['flagPost']['postId']).toBe(postId)

  // check we can see we flagged the post
  resp = await ourClient.query({query: schema.post, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['post']['flagStatus']).toBe('FLAGGED')

  // we reset our user, should clear the flag
  await ourClient.mutate({mutation: schema.resetUser, variables: {newUsername: ourUsername}})

  // check we can that we have not flagged the post
  resp = await ourClient.query({query: schema.post, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['post']['flagStatus']).toBe('NOT_FLAGGED')
})


test('resetUser with optional username intializes new user correctly', async () => {
  const [client, userId, password, email] = await loginCache.getCleanLogin()
  const newUsername = cognito.generateUsername()

  // reset our user
  let resp = await client.mutate({mutation: schema.resetUser, variables: {newUsername}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['resetUser']['userId']).toBe(userId)
  expect(resp['data']['resetUser']['username']).toBe(newUsername)
  expect(resp['data']['resetUser']['fullName']).toBeNull()

  // make sure it stuck in the DB
  resp = await client.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['userId']).toBe(userId)
  expect(resp['data']['self']['username']).toBe(newUsername)
  expect(resp['data']['self']['email']).toBe(email)

  // make sure we can login with the new username
  let AuthParameters = {USERNAME: newUsername.toLowerCase(), PASSWORD: password}
  resp = await cognito.userPoolClient.initiateAuth({AuthFlow, AuthParameters}).promise()
  expect(resp).toHaveProperty('AuthenticationResult.AccessToken')
})


test('resetUser deletes any comments we have added to posts', async () => {
  const [ourClient, , , , ourUsername] = await loginCache.getCleanLogin()
  const [theirClient] = await loginCache.getCleanLogin()

  // they add a post
  const postId = uuidv4()
  let resp = await theirClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId, text: 'lore ipsum'}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addPost']['postId']).toBe(postId)

  // we add a comment to that post
  const commentId = uuidv4()
  resp = await ourClient.mutate({mutation: schema.addComment, variables: {postId, commentId, text: 'lore'}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addComment']['commentId']).toBe(commentId)

  // check they can see our comment on the post
  resp = await theirClient.query({query: schema.post, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['post']['commentCount']).toBe(1)
  expect(resp['data']['post']['comments']['items']).toHaveLength(1)
  expect(resp['data']['post']['comments']['items'][0]['commentId']).toBe(commentId)

  // we reset our user, should delete the comment
  await ourClient.mutate({mutation: schema.resetUser, variables: {newUsername: ourUsername}})

  // check the comment has disappeared
  resp = await theirClient.query({query: schema.post, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['post']['commentCount']).toBe(0)
  expect(resp['data']['post']['comments']['items']).toHaveLength(0)
})
