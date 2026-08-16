describe('Login module isolation', () => {
  test('does not load user-data callables while the login route module initializes', () => {
    jest.resetModules();
    let commandModuleLoads = 0;

    jest.doMock('../data/userData/userDataCommands', () => {
      commandModuleLoads += 1;
      return {
        updateCharacterCreation: jest.fn(() => Promise.resolve()),
      };
    });
    jest.doMock('./firebaseConfig', () => ({ auth: {} }));
    jest.doMock('firebase/auth', () => ({
      signInWithEmailAndPassword: jest.fn(),
      createUserWithEmailAndPassword: jest.fn(),
      fetchSignInMethodsForEmail: jest.fn(),
    }));
    jest.doMock('../AuthContext', () => ({
      useAuthSession: jest.fn(),
      useProfileState: jest.fn(),
    }));
    jest.doMock('react-router-dom', () => ({
      useNavigate: jest.fn(),
    }), { virtual: true });
    jest.doMock('./backgrounds/AuroraBackground', () => () => null);
    jest.doMock('./LoginCreateButton', () => () => null);

    jest.isolateModules(() => {
      require('./Login');
    });

    expect(commandModuleLoads).toBe(0);
  });
});
