import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { useAuthSession } from '../../AuthContext';
import { USER_DATA_DOMAINS, USER_DATA_ROLLOUT_STAGES } from './domainSchema';
import { useUserDomain } from './userDataHooks';
import { subscribeUserDomain } from './userDataRepository';

let currentUser;
let subscriptions;

jest.mock('../../AuthContext', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('./userDataRepository', () => ({
  subscribeUserDomain: jest.fn(),
}));

const DomainProbe = ({ domain }) => {
  const state = useUserDomain(domain);
  return (
    <div>
      <span data-testid="uid">{state.uid || 'none'}</span>
      <span data-testid="status">{state.status}</span>
      <span data-testid="value">{state.data?.secret || state.data?.stats?.gold || 'none'}</span>
      <span data-testid="source">{state.source || 'none'}</span>
    </div>
  );
};

const emit = (index, data) => act(() => subscriptions[index].observer.next(data, {
  source: 'legacy',
  stage: USER_DATA_ROLLOUT_STAGES.LEGACY_READ,
}));

describe('useUserDomain subscription identity', () => {
  beforeEach(() => {
    subscriptions = [];
    currentUser = { uid: 'user-1' };
    useAuthSession.mockImplementation(() => ({ user: currentUser }));
    subscribeUserDomain.mockImplementation((uid, domain, observer) => {
      const subscription = { uid, domain, observer, unsubscribe: jest.fn() };
      subscriptions.push(subscription);
      return subscription.unsubscribe;
    });
  });

  test('accepts two successive snapshots for one identity', () => {
    render(<DomainProbe domain={USER_DATA_DOMAINS.RESOURCES} />);
    emit(0, { stats: { gold: 10 } });
    expect(screen.getByTestId('value')).toHaveTextContent('10');

    emit(0, { stats: { gold: 20 } });
    expect(screen.getByTestId('value')).toHaveTextContent('20');
    expect(screen.getByTestId('status')).toHaveTextContent('fresh');
  });

  test('clears old account data before the next account emits and ignores late callbacks', () => {
    const view = render(<DomainProbe domain={USER_DATA_DOMAINS.RESOURCES} />);
    emit(0, { secret: 'first-account-secret' });
    expect(screen.getByTestId('value')).toHaveTextContent('first-account-secret');

    currentUser = { uid: 'user-2' };
    view.rerender(<DomainProbe domain={USER_DATA_DOMAINS.RESOURCES} />);

    expect(screen.getByTestId('uid')).toHaveTextContent('user-2');
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('value')).toHaveTextContent('none');
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);

    emit(0, { secret: 'late-first-account-secret' });
    expect(screen.getByTestId('value')).toHaveTextContent('none');
    emit(1, { secret: 'second-account-data' });
    expect(screen.getByTestId('value')).toHaveTextContent('second-account-data');
  });

  test('clears the prior domain synchronously when the domain changes', () => {
    const view = render(<DomainProbe domain={USER_DATA_DOMAINS.RESOURCES} />);
    emit(0, { secret: 'resource-data' });

    view.rerender(<DomainProbe domain={USER_DATA_DOMAINS.PROGRESSION} />);

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('value')).toHaveTextContent('none');
    expect(subscriptions[1]).toEqual(expect.objectContaining({
      uid: 'user-1',
      domain: USER_DATA_DOMAINS.PROGRESSION,
    }));
  });
});
