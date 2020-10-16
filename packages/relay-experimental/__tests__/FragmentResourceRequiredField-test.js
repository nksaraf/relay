/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails oncall+relay
 * @flow
 * @format
 */

'use strict';

jest.mock('relay-runtime', () => {
  const originalRuntime = jest.requireActual('relay-runtime');
  const originalInternal = originalRuntime.__internal;
  return {
    ...originalRuntime,
    __internal: {
      ...originalInternal,
      getPromiseForActiveRequest: jest.fn(),
    },
  };
});

const {getFragmentResourceForEnvironment} = require('../FragmentResource');
const {
  __internal: {getPromiseForActiveRequest},
  createOperationDescriptor,
  getFragment,
  RelayFeatureFlags,
} = require('relay-runtime');

beforeEach(() => {
  RelayFeatureFlags.ENABLE_REQUIRED_DIRECTIVES = true;
});

afterEach(() => {
  RelayFeatureFlags.ENABLE_REQUIRED_DIRECTIVES = false;
  (getPromiseForActiveRequest: any).mockReset();
});

let environment;
let query;
let FragmentResource;
let UserFragment;
let logger;
let requiredFieldLogger;
const componentDisplayName = 'TestComponent';

beforeEach(() => {
  const {
    createMockEnvironment,
    generateAndCompile,
  } = require('relay-test-utils-internal');

  logger = jest.fn();
  requiredFieldLogger = jest.fn();

  environment = createMockEnvironment({
    log: logger,
    requiredFieldLogger,
  });
  FragmentResource = getFragmentResourceForEnvironment(environment);

  const sections = generateAndCompile(
    `
        fragment UserFragment on User {
          id
          name @required(action: THROW)
          alternate_name @required(action: LOG)
        }
        query UserQuery($id: ID!) {
          node(id: $id) {
            __typename
            ...UserFragment
          }
        }
    `,
  );

  UserFragment = sections.UserFragment;

  query = createOperationDescriptor(sections.UserQuery, {id: '4'});
});

test('Throws if a @required(action: THROW) field is null', () => {
  environment.commitPayload(query, {
    node: {
      __typename: 'User',
      id: '4',
      name: null,
      alternate_name: 'Zuckster',
    },
  });
  expect(() => {
    FragmentResource.read(
      getFragment(UserFragment),
      {
        __id: '4',
        __fragments: {
          UserFragment: {},
        },
        __fragmentOwner: query.request,
      },
      componentDisplayName,
    );
  }).toThrowError(
    "Relay: Missing @required value at path 'name' in 'UserFragment'.",
  );
});

test('Logs if a @required(action: LOG) field is null', () => {
  environment.commitPayload(query, {
    node: {
      __typename: 'User',
      id: '4',
      name: 'Zucc',
      alternate_name: null,
    },
  });
  FragmentResource.read(
    getFragment(UserFragment),
    {
      __id: '4',
      __fragments: {
        UserFragment: {},
      },
      __fragmentOwner: query.request,
    },
    componentDisplayName,
  );
  expect(requiredFieldLogger).toHaveBeenCalledWith({
    fieldPath: 'alternate_name',
    kind: 'missing_field.log',
    owner: 'UserFragment',
  });
  expect(logger).toHaveBeenCalledWith({
    fieldPath: 'alternate_name',
    name: 'read.missing_required_field',
    owner: 'UserFragment',
  });
});

test('Throws if a @required(action: THROW) field is present and then goes missing', () => {
  const callback = jest.fn();
  environment.commitPayload(query, {
    node: {
      __typename: 'User',
      id: '4',
      name: 'Zucc',
      alternate_name: 'Zuckster',
    },
  });
  const result = FragmentResource.read(
    getFragment(UserFragment),
    {
      __id: '4',
      __fragments: {
        UserFragment: {},
      },
      __fragmentOwner: query.request,
    },
    componentDisplayName,
  );
  expect(result.data).toEqual({
    id: '4',
    name: 'Zucc',
    alternate_name: 'Zuckster',
  });

  expect(environment.subscribe).toHaveBeenCalledTimes(0);
  const disposable = FragmentResource.subscribe(result, callback);

  environment.commitPayload(query, {
    node: {
      __typename: 'User',
      id: '4',
      name: null,
      alternate_name: 'Zuckster',
    },
  });

  expect(() =>
    FragmentResource.read(
      getFragment(UserFragment),
      {
        __id: '4',
        __fragments: {
          UserFragment: {},
        },
        __fragmentOwner: query.request,
      },
      componentDisplayName,
    ),
  ).toThrowError(
    "Relay: Missing @required value at path 'name' in 'UserFragment'.",
  );

  expect(requiredFieldLogger).toHaveBeenCalledWith({
    fieldPath: 'name',
    kind: 'missing_field.throw',
    owner: 'UserFragment',
  });

  disposable.dispose();
});

it('should throw promise if reading missing data and network request for parent query is in flight', async () => {
  const requestPromise = Promise.resolve();
  (getPromiseForActiveRequest: any).mockReturnValue(requestPromise);
  const fragmentNode = getFragment(UserFragment);
  const fragmentRef = {
    __id: '4',
    __fragments: {
      UserFragment: {},
    },
    __fragmentOwner: query.request,
  };

  // Try reading a fragment while parent query is in flight
  let thrown = null;
  try {
    FragmentResource.read(fragmentNode, fragmentRef, componentDisplayName);
  } catch (p) {
    thrown = p;
  }

  expect(thrown).toBeInstanceOf(Promise);

  environment.commitPayload(query, {
    node: {
      __typename: 'User',
      id: '4',
      name: null,
      alternate_name: 'Zuckster',
    },
  });

  await requestPromise;

  // Now that the request is complete, check that we detect the missing field.
  expect(() =>
    FragmentResource.read(
      getFragment(UserFragment),
      fragmentRef,
      componentDisplayName,
    ),
  ).toThrowError(
    "Relay: Missing @required value at path 'name' in 'UserFragment'.",
  );
});
