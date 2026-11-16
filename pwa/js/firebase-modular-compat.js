/* ==========================================================================
   firebase-modular-compat.js — Modüler Firebase SDK + persistentLocalCache köprüsü
   --------------------------------------------------------------------------
   Eski compat paketleri db.enablePersistence({ synchronizeTabs: true })
   kullanmaya zorlayıp konsolda kullanımdan kaldırılma uyarısı üretiyordu.
   Bu modül, resmi Firebase 10.12.2 modüler ESM paketlerini dinamik import()
   ile yükler ve Firestore'u modern:
     initializeFirestore(app, {
       localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
     })
   ayarıyla başlatarak firebase.js için uyumlu window.firebase arayüzünü sunar.
   ========================================================================== */

(function () {
  'use strict';

  const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';

  if (typeof window === 'undefined') return;
  if (window.firebase && typeof window.firebase.initializeApp === 'function') {
    window.__firebaseReady = Promise.resolve(window.firebase);
    return;
  }

  let readyPromise = null;

  function loadModularFirebase() {
    if (readyPromise) return readyPromise;

    readyPromise = Promise.all([
      import(SDK_BASE + 'firebase-app.js'),
      import(SDK_BASE + 'firebase-auth.js'),
      import(SDK_BASE + 'firebase-firestore.js')
    ]).then(function (mods) {
      const appMod = mods[0];
      const authMod = mods[1];
      const fsMod = mods[2];

      const userWrappers = new WeakMap();
      const dbCache = new WeakMap();

      function wrapUser(rawUser) {
        if (!rawUser) return null;
        let w = userWrappers.get(rawUser);
        if (!w) {
          w = {
            _raw: rawUser,
            get uid() { return rawUser.uid; },
            get email() { return rawUser.email; },
            get emailVerified() { return rawUser.emailVerified; },
            get displayName() { return rawUser.displayName; },
            get photoURL() { return rawUser.photoURL; },
            get metadata() { return rawUser.metadata; },
            get providerData() { return rawUser.providerData; },
            getIdToken: function (forceRefresh) {
              return authMod.getIdToken(rawUser, !!forceRefresh);
            },
            reload: function () {
              return authMod.reload(rawUser);
            },
            sendEmailVerification: function () {
              return authMod.sendEmailVerification(rawUser);
            },
            updateProfile: function (profile) {
              return authMod.updateProfile(rawUser, profile);
            },
            updatePassword: function (newPassword) {
              return authMod.updatePassword(rawUser, newPassword);
            },
            updateEmail: function (newEmail) {
              return authMod.updateEmail(rawUser, newEmail);
            },
            reauthenticateWithCredential: function (credential) {
              return authMod.reauthenticateWithCredential(rawUser, credential);
            }
          };
          userWrappers.set(rawUser, w);
        }
        return w;
      }

      function wrapAuth(rawAuth) {
        return {
          _raw: rawAuth,
          get currentUser() { return wrapUser(rawAuth.currentUser); },
          onAuthStateChanged: function (next, error, completed) {
            return authMod.onAuthStateChanged(
              rawAuth,
              function (u) { if (typeof next === 'function') next(wrapUser(u)); },
              error,
              completed
            );
          },
          signInWithEmailAndPassword: function (email, password) {
            return authMod.signInWithEmailAndPassword(rawAuth, email, password).then(function (cred) {
              return { user: wrapUser(cred.user), credential: cred.credential || null };
            });
          },
          createUserWithEmailAndPassword: function (email, password) {
            return authMod.createUserWithEmailAndPassword(rawAuth, email, password).then(function (cred) {
              return { user: wrapUser(cred.user), credential: cred.credential || null };
            });
          },
          signInWithPopup: function (provider) {
            return authMod.signInWithPopup(rawAuth, provider).then(function (cred) {
              return { user: wrapUser(cred.user), credential: cred.credential || null };
            });
          },
          signInWithRedirect: function (provider) {
            return authMod.signInWithRedirect(rawAuth, provider);
          },
          getRedirectResult: function () {
            return authMod.getRedirectResult(rawAuth).then(function (res) {
              if (!res) return null;
              return { user: res.user ? wrapUser(res.user) : null, credential: res.credential || null };
            });
          },
          signInWithCredential: function (credential) {
            return authMod.signInWithCredential(rawAuth, credential).then(function (cred) {
              return { user: wrapUser(cred.user), credential: cred.credential || null };
            });
          },
          signOut: function () {
            return authMod.signOut(rawAuth);
          },
          sendPasswordResetEmail: function (email) {
            return authMod.sendPasswordResetEmail(rawAuth, email);
          }
        };
      }

      function wrapDocRef(rawRef) {
        return {
          _rawRef: rawRef,
          get id() { return rawRef.id; },
          get path() { return rawRef.path; },
          get: function () {
            return fsMod.getDoc(rawRef).then(wrapDocSnap);
          },
          set: function (data, opts) {
            return opts ? fsMod.setDoc(rawRef, data, opts) : fsMod.setDoc(rawRef, data);
          },
          update: function (data) {
            return fsMod.updateDoc(rawRef, data);
          },
          delete: function () {
            return fsMod.deleteDoc(rawRef);
          }
        };
      }

      function wrapDocSnap(snap) {
        return {
          id: snap.id,
          exists: snap.exists(),
          ref: wrapDocRef(snap.ref),
          data: function () { return snap.data(); },
          get: function (field) { return snap.get(field); }
        };
      }

      function wrapQuerySnap(qsnap) {
        const docs = qsnap.docs.map(wrapDocSnap);
        return {
          docs: docs,
          empty: qsnap.empty,
          size: qsnap.size,
          forEach: function (fn) { docs.forEach(fn); }
        };
      }

      function wrapQuery(rawQuery) {
        return {
          _rawQuery: rawQuery,
          where: function (field, op, value) {
            return wrapQuery(fsMod.query(rawQuery, fsMod.where(field, op, value)));
          },
          orderBy: function (field, dir) {
            return wrapQuery(fsMod.query(rawQuery, dir ? fsMod.orderBy(field, dir) : fsMod.orderBy(field)));
          },
          limit: function (n) {
            return wrapQuery(fsMod.query(rawQuery, fsMod.limit(n)));
          },
          get: function () {
            return fsMod.getDocs(rawQuery).then(wrapQuerySnap);
          }
        };
      }

      function createFirestoreCompat(rawApp) {
        if (dbCache.has(rawApp)) return dbCache.get(rawApp);

        let rawDb;
        try {
          rawDb = fsMod.initializeFirestore(rawApp, {
            localCache: fsMod.persistentLocalCache({
              tabManager: fsMod.persistentMultipleTabManager()
            })
          });
        } catch (err) {
          try {
            rawDb = fsMod.getFirestore(rawApp);
          } catch (err2) {
            rawDb = fsMod.initializeFirestore(rawApp, {
              localCache: fsMod.memoryLocalCache()
            });
          }
        }

        const compatDb = {
          _raw: rawDb,
          _persistentCacheConfigured: true,
          collection: function (colPath) {
            const rawCol = fsMod.collection(rawDb, colPath);
            const q = wrapQuery(rawCol);
            q.doc = function (id) {
              const rawRef = (id !== undefined && id !== null && String(id) !== '')
                ? fsMod.doc(rawDb, colPath, String(id))
                : fsMod.doc(rawCol);
              return wrapDocRef(rawRef);
            };
            q.add = function (data) {
              return fsMod.addDoc(rawCol, data).then(wrapDocRef);
            };
            return q;
          },
          runTransaction: function (fn) {
            return fsMod.runTransaction(rawDb, function (rawTx) {
              const compatTx = {
                get: function (docRef) {
                  return rawTx.get(docRef._rawRef || docRef).then(wrapDocSnap);
                },
                set: function (docRef, data, opts) {
                  const target = docRef._rawRef || docRef;
                  if (opts) rawTx.set(target, data, opts);
                  else rawTx.set(target, data);
                  return compatTx;
                },
                update: function (docRef, data) {
                  rawTx.update(docRef._rawRef || docRef, data);
                  return compatTx;
                },
                delete: function (docRef) {
                  rawTx.delete(docRef._rawRef || docRef);
                  return compatTx;
                }
              };
              return fn(compatTx);
            });
          },
          batch: function () {
            const rawBatch = fsMod.writeBatch(rawDb);
            const compatBatch = {
              set: function (docRef, data, opts) {
                const target = docRef._rawRef || docRef;
                if (opts) rawBatch.set(target, data, opts);
                else rawBatch.set(target, data);
                return compatBatch;
              },
              update: function (docRef, data) {
                rawBatch.update(docRef._rawRef || docRef, data);
                return compatBatch;
              },
              delete: function (docRef) {
                rawBatch.delete(docRef._rawRef || docRef);
                return compatBatch;
              },
              commit: function () {
                return rawBatch.commit();
              }
            };
            return compatBatch;
          },
          enablePersistence: function () {
            return Promise.resolve();
          }
        };

        dbCache.set(rawApp, compatDb);
        return compatDb;
      }

      function findExistingApp(appName) {
        const apps = appMod.getApps();
        for (let i = 0; i < apps.length; i++) {
          if (apps[i].name === appName) return apps[i];
        }
        return null;
      }

      const compatNamespace = {
        _modular: true,
        initializeApp: function (config, name) {
          const targetName = name || '[DEFAULT]';
          const rawApp = findExistingApp(targetName) || (name ? appMod.initializeApp(config, name) : appMod.initializeApp(config));
          const authWrapper = wrapAuth(authMod.getAuth(rawApp));
          let fsWrapper = null;
          return {
            _raw: rawApp,
            name: rawApp.name,
            auth: function () { return authWrapper; },
            firestore: function () {
              if (!fsWrapper) fsWrapper = createFirestoreCompat(rawApp);
              return fsWrapper;
            },
            delete: function () { return appMod.deleteApp(rawApp); }
          };
        },
        auth: function () {
          const rawApp = findExistingApp('[DEFAULT]');
          if (!rawApp) throw new Error('Firebase varsayılan uygulama başlatılmadı.');
          return wrapAuth(authMod.getAuth(rawApp));
        },
        firestore: function () {
          const rawApp = findExistingApp('[DEFAULT]');
          if (!rawApp) throw new Error('Firebase varsayılan uygulama başlatılmadı.');
          return createFirestoreCompat(rawApp);
        }
      };

      compatNamespace.auth.GoogleAuthProvider = authMod.GoogleAuthProvider;
      compatNamespace.auth.GithubAuthProvider = authMod.GithubAuthProvider;
      compatNamespace.auth.OAuthProvider = authMod.OAuthProvider;
      compatNamespace.auth.EmailAuthProvider = authMod.EmailAuthProvider;

      compatNamespace.firestore.FieldValue = {
        serverTimestamp: function () { return fsMod.serverTimestamp(); },
        delete: function () { return fsMod.deleteField(); }
      };
      compatNamespace.firestore.Timestamp = fsMod.Timestamp;

      compatNamespace._activateAppCheck = function (siteKey, rawApp) {
        return import(SDK_BASE + 'firebase-app-check.js').then(function (acMod) {
          const target = rawApp || findExistingApp('[DEFAULT]');
          if (!target) return null;
          return acMod.initializeAppCheck(target, {
            provider: new acMod.ReCaptchaV3Provider(siteKey),
            isTokenAutoRefreshEnabled: true
          });
        });
      };

      window.firebase = compatNamespace;
      return compatNamespace;
    });

    return readyPromise;
  }

  window.__firebaseReady = loadModularFirebase();
})();
