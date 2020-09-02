#!/usr/bin/env node

/* eslint no-unused-vars: 0 */

const AWS = require('aws-sdk')
const {default: AWSAppSyncClient, createAppSyncLink} = require('aws-appsync')
const {setContext} = require('apollo-link-context')
const {ApolloLink} = require('apollo-link')
const {createHttpLink} = require('apollo-link-http')
const dotenv = require('dotenv')
const fs = require('fs')
const gql = require('graphql-tag')
const util = require('util')
const uuidv4 = require('uuid/v4')
require('isomorphic-fetch')

const {mutations, queries} = require('../schema')

dotenv.config()
AWS.config = new AWS.Config()

const appsyncApiUrl = process.env.APPSYNC_GRAPHQL_URL
if (appsyncApiUrl === undefined) throw new Error('Env var APPSYNC_GRAPHQL_URL must be defined')

if (process.argv.length != 3) {
  console.log('Usage: run.gql.js <tokens/credential file generated by sign-user-in.js>')
  process.exit(1)
}

const tokensCreds = JSON.parse(fs.readFileSync(process.argv[2]))
const authProvider = tokensCreds.authProvider

const awsCredentials = new AWS.Credentials(
  tokensCreds.credentials.AccessKeyId,
  tokensCreds.credentials.SecretKey,
  tokensCreds.credentials.SessionToken,
)

const appsyncConfig = {
  url: appsyncApiUrl,
  region: AWS.config.region,
  auth: {
    type: 'AWS_IAM',
    credentials: awsCredentials,
  },
  disableOffline: true,
}
const appsyncOptions = {
  defaultOptions: {query: {fetchPolicy: 'no-cache'}},
  link: createAppSyncLink({
    ...appsyncConfig,
    resultsFetcherLink: ApolloLink.from([
      setContext((request, previousContext) => ({
        headers: {
          ...previousContext.headers,
          ['x-real-version']: '1.2.3(456)',
          ['x-real-device']: 'iPhone7,2', // https://www.npmjs.com/package/react-native-device-info#getdeviceid
          ['x-real-system']: 'iOS 11.0', // https://www.npmjs.com/package/react-native-device-info#getsystemname
        },
      })),
      createHttpLink({
        uri: appsyncConfig.url,
      }),
    ]),
  }),
}
const appsyncClient = new AWSAppSyncClient(appsyncConfig, appsyncOptions)

const startChangeUserEmail = gql`
  mutation StartChangeUserEmail($email: AWSEmail!) {
    startChangeUserEmail(email: $email) {
      userId
      username
      email
      phoneNumber
    }
  }
`

const finishChangeUserEmail = gql`
  mutation FinishChangeUserEmail($verificationCode: String!) {
    finishChangeUserEmail(verificationCode: $verificationCode) {
      userId
      username
      email
      phoneNumber
    }
  }
`

const startChangeUserPhoneNumber = gql`
  mutation StartChangeUserPhoneNumber($phoneNumber: AWSPhone!) {
    startChangeUserPhoneNumber(phoneNumber: $phoneNumber) {
      userId
      username
      email
      phoneNumber
    }
  }
`

const finishChangeUserPhoneNumber = gql`
  mutation FinishChangeUserPhoneNumber($verificationCode: String!) {
    finishChangeUserPhoneNumber(verificationCode: $verificationCode) {
      userId
      username
      email
      phoneNumber
    }
  }
`

const setUserDetails = gql`
  mutation SetUserDetails {
    setUserDetails(fullName: "Miss. Purple", bio: "millions of peaches") {
      userId
      username
      fullName
      bio
      email
      phoneNumber
      birthday
      gender
    }
  }
`

const linkAppleLogin = gql`
  mutation LinkAppleLogin($appleIdToken: String!) {
    linkAppleLogin(appleIdToken: $appleIdToken) {
      userId
      userStatus
      email
    }
  }
`

const linkFacebookLogin = gql`
  mutation LinkFacebookLogin($facebookAccessToken: String!) {
    linkFacebookLogin(facebookAccessToken: $facebookAccessToken) {
      userId
      userStatus
      email
    }
  }
`

const linkGoogleLogin = gql`
  mutation LinkGoogleLogin($googleIdToken: String!) {
    linkGoogleLogin(googleIdToken: $googleIdToken) {
      userId
      userStatus
      email
    }
  }
`

const lambdaClientError = gql`
  mutation LambdaClientError {
    lambdaClientError(arg1: "test-arg1", arg2: "test-arg2")
  }
`

const lambdaServerError = gql`
  mutation LambdaServerError {
    lambdaServerError(arg1: "test-arg1", arg2: "test-arg2")
  }
`

const dynamoServerError = gql`
  mutation DynamoServerError {
    dynamoServerError(arg1: "test-arg1", arg2: "test-arg2")
  }
`

const main = async () => {
  const resp = await appsyncClient.query({query: queries.self})
  //const resp = await appsyncClient.mutate({mutation: mutations.createAnonymousUser})
  /*
  const resp = await appsyncClient.mutate({
    mutation: mutations.createCognitoOnlyUser,
    variables: {username: uuidv4().substring(24), fullName: 'my full name'},
  })
  const resp = await appsyncClient.mutate({mutation: mutations.resetUser})
  const resp = await appsyncClient.mutate({
    mutation: startChangeUserEmail,
    variables: {email: ''},
  })
  const resp = await appsyncClient.mutate({
    mutation: finishChangeUserEmail,
    variables: {verificationCode: ''},
  })
  const resp = await appsyncClient.mutate({
    mutation: startChangeUserPhoneNumber,
    variables: {phoneNumber: ''},
  })
  const resp = await appsyncClient.mutate({
    mutation: finishChangeUserPhoneNumber,
    variables: {verificationCode: ''},
  })
  */
  // log object to full depth https://stackoverflow.com/a/10729284
  console.log(JSON.stringify(resp, null, 2))
}

main()
