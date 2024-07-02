import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
} from "amazon-cognito-identity-js";
import { useCallback, useContext, useState } from "react";
import Pool from "@/utils/userPool";
import { AppContext } from "@/context/AppContext";
import {
  authenticateUser,
  managedCognitoUser,
  mfaAuthenticateUser,
} from "@/utils/functions";
import { useMarketplace } from "./useMarketplace";

import { getCustomer, register } from "@/services/functions/customer";

import {
  CustomerType,
  GetCustomerResponse,
} from "@/services/functions/customer/customer.types";
import { SignUpType } from "@/utils/types";
import { useNavigate } from "react-router-dom";

export let cognitoUser = managedCognitoUser;

type Session = {
  accessToken: {
    jwtToken: string;
  };
} | null;
const useAuth = () => {
  const navigate = useNavigate();

  const [isSigning, setIsSigning] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const { userData, setUserData } = useContext(AppContext);
  const { extractMarketplaceInfo } = useMarketplace();

  const userSession = async (): Promise<{
    session: Session;
    currentUser: CognitoUser;
  }> => {
    setIsChecking(true);
    return await new Promise((resolve, reject) => {
      const currentUser = Pool.getCurrentUser();
      if (!currentUser) {
        reject("User not found. Reject and redirect to login page.");
      } else {
        currentUser.getSession((err: Error | null, session: null) => {
          if (err) {
            reject("Session error. Reject: " + err);
          } else {
            resolve({ session, currentUser });
          }
        });
      }
    });
  };

  const setupUserInfo = async (currentUser: CognitoUser) => {
    try {
      const userInfo = await updateUserAttributes(currentUser);
      const data = {
        ...userData,
        attributes: userInfo,
      };
      setUserData(data);
    } catch (e) {
      console.log(e);
    }
  };

  const updateUserAttributes = async (
    currentUser: CognitoUser
  ): Promise<{ name: string; id: string }> => {
    return await new Promise((resolve, reject) => {
      currentUser.getUserAttributes(function (err, userAttrs) {
        if (err) {
          console.log(err.message || JSON.stringify(err));
          reject(err.message);
        }
        const userInfo = {
          name: "",
          id: "",
        };
        userAttrs?.forEach(function (attribute) {
          if (attribute.getName() === "name") userInfo.name = attribute.Value;
          userInfo.id = String(5771); // hardcoded value
        });

        resolve(userInfo);
      });
    });
  };

  const getUserAttributes = async (
    currentUser: CognitoUser
  ): Promise<CognitoUserAttribute[] | undefined> => {
    return await new Promise((resolve, reject) => {
      currentUser.getUserAttributes(function (err, userAttrs) {
        if (err) {
          console.log(err.message || JSON.stringify(err));
          reject(err.message);
        }
        resolve(userAttrs);
      });
    });
  };

  const signIn = async (email: string, password: string) => {
    setErrorMessage("");
    setIsSigning(true);

    managedCognitoUser.set(email, Pool);

    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    try {
      await authenticateUser(authDetails);
      await handleAuth();
      return "success";
    } catch (error) {
      if (error === "mfa") {
        const data = {
          ...userData,
          email: email,
          password: password,
        };
        setUserData(data);
        setIsSigning(false);
        return "mfa";
      }
      setErrorMessage("Incorrect user or password.");
      setIsSigning(false);
      return "incorrect";
    }
  };

  const mfaSignIn = async (code: string) => {
    setErrorMessage("");
    setIsSigning(true);

    managedCognitoUser.set(userData?.email, Pool);

    const authDetails = new AuthenticationDetails({
      Username: userData.email,
      Password: userData.password,
    });

    try {
      await mfaAuthenticateUser(authDetails, code);
      await handleAuth();
    } catch (error) {
      setErrorMessage(String(error));
      setIsSigning(false);
      return false;
    }
  };

  const logOut = async (shouldClear = true) => {
    return await new Promise((resolve, reject) => {
      const user = Pool.getCurrentUser();
      if (user) {
        user.signOut(() => {
          if (shouldClear) {
            window.localStorage.removeItem("email");

            setUserData({
              email: "",
              password: "",
              company: "",
            });
          }

          resolve(true);
        });
      } else {
        reject("User not found");
      }
    });
  };

  const signUp = useCallback(
    async (data: SignUpType): Promise<{ error: boolean; path: string }> => {
      setErrorMessage("");

      const searchParams = userData.search;

      let plan;

      if (searchParams) {
        plan =
          searchParams.get("x-amzn-marketplace-offer-type") == "free-trial"
            ? "Free"
            : "Paid";
      }

      const { name, email, password, company } = data;
      const timestamp = new Date().getTime() / 1000;

      const attributes: Record<string, string> = {
        email,
        name,
        family_name: name.split(" ")[1],
        "custom:Tier": "1",
        "custom:Plan": plan || "Free",
        "custom:Role": "Admin",
        "custom:Company": company,
        "custom:Created": timestamp.toString(),
      };

      const attributeList = Object.keys(attributes).map((key) => {
        const attribute = new CognitoUserAttribute({
          Name: key,
          Value: attributes[key],
        });
        return attribute;
      });

      return new Promise((resolve, reject) => {
        Pool.signUp(email, password, attributeList, [], (err) => {
          if (err) {
            setErrorMessage(err?.message);
            reject({ error: true, path: "/", errorMessage: err?.message });
          }

          setUserData({
            cognitoUser: managedCognitoUser.get(),
            email,
            password: password,
            search: searchParams,
            company: company,
          });

          resolve({ error: false, path: "/confirm-account" });
        });
      });
    },
    [Pool]
  );

  const confirmEmail = async (
    code: string
  ): Promise<{ error: boolean; path: string }> => {
    setErrorMessage("");
    const data = {
      Username: userData?.email,
      Pool: Pool,
    };

    const cognitoUser = new CognitoUser(data);

    return new Promise((resolve, reject) => {
      cognitoUser.confirmRegistration(code, true, (err, _) => {
        (async () => {
          if (err) {
            setErrorMessage(err.message || JSON.stringify(err));
            reject({ error: true, path: err.message });
          } else {
            // const res = await signIn(userData.email, userData.password);
            try {
              if (!userData.password) {
                throw new Error("No password provided");
              }
              resolve({ error: false, path: "/mfa" });
            } catch (error) {
              let message = "";
              if (error instanceof Error) message = error.message;
              setErrorMessage(message);
              reject({ error: true, path: message });
            }
          }
        })();
      });
    });
  };

  type ConfirmPasswordType = {
    email: string;
    temporaryPassword: string;
    newPassword: string;
  };

  type ConfirmPasswordResponseType =
    | undefined
    | {
        UserAttributes: Array<{
          Name: string;
          Value: string;
        }>;
        Username: string;
      };

  const changeTemporaryPassword = async ({
    email,
    temporaryPassword,
    newPassword,
  }: ConfirmPasswordType): Promise<ConfirmPasswordResponseType> => {
    const cognitoUser = managedCognitoUser;

    const authenticationData = {
      Username: email,
      Password: temporaryPassword,
    };

    const authenticationDetails = new AuthenticationDetails(authenticationData);

    cognitoUser.set(email, Pool);

    return new Promise((resolve, reject) => {
      cognitoUser.get().authenticateUser(authenticationDetails, {
        onSuccess: () => {
          cognitoUser
            .get()
            .changePassword(temporaryPassword, newPassword, (err) => {
              if (err) {
                console.error(err);
                reject(err);
              } else {
                // Get user data
                cognitoUser.get().getUserData((err, userData) => {
                  if (err) {
                    console.error(err);
                    reject(err);
                  }
                  resolve(userData);
                });
              }
            });
        },
        onFailure: (err) => {
          console.error(err);
          reject(err);
        },
      });
    });
  };

  const resendCode = async () => {
    const data = {
      Username: userData.email,
      Pool: Pool,
    };

    const cognitoUser = new CognitoUser(data);

    cognitoUser.resendConfirmationCode((err, result) => {
      if (err) {
        alert(err.message || JSON.stringify(err));
        console.log(err);
        return;
      }
      console.log("call result: " + result);
    });
  };

  const selectMfa = async (password: string) => {
    const cognitoUser = new CognitoUser({
      Username: userData.email,
      Pool: Pool,
    });

    const authDetails = new AuthenticationDetails({
      Username: userData.email,
      Password: password,
    });

    return new Promise((resolve, reject) => {
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: () => {
          cognitoUser.associateSoftwareToken({
            associateSecretCode: (secretCode) => {
              resolve(secretCode);
            },
            onFailure: (err) => {
              console.error(err);
              reject(err);
            },
          });
        },
        onFailure: (err) => {
          console.error(err);
          reject(err);
        },
        selectMFAType: () => {
          cognitoUser.sendMFASelectionAnswer("SOFTWARE_TOKEN_MFA", {
            onSuccess: () => {
              resolve("success");
            },
            onFailure: (a) => {
              console.error(a);
              reject(a);
            },
          });
        },
      });
    });
  };

  const confirmMfaSetup = async (
    token: string,
    deviceName: string,
    sms: boolean
  ) => {
    const cognitoUser = new CognitoUser({
      Username: userData?.email,
      Pool: Pool,
    });
    const authDetails = new AuthenticationDetails({
      Username: userData?.email,
      Password: userData?.password,
    });

    const softwareTokenMfaSettings = {
      PreferredMfa: true,
      Enabled: true,
    };

    const smsMfaSettings = softwareTokenMfaSettings;

    return new Promise((resolve, reject) => {
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: () => {
          cognitoUser.verifySoftwareToken(token, deviceName, {
            onSuccess: async () => {
              cognitoUser.setUserMfaPreference(
                sms ? smsMfaSettings : null,
                sms ? null : softwareTokenMfaSettings,
                (err) => {
                  if (err) {
                    console.error(err);
                    reject(err);
                  }
                }
              );
              try {
                await handleAuth();
                // Check if the token is valid
                const { token, plan, isValid } = await extractMarketplaceInfo();
                // In case the token is not valid then navigate to interstitial page
                if (!isValid || !token) {
                  navigate("/interstitial");
                  return;
                }

                // Else register the new client
                await register(token, plan);

                // eslint-disable-next-line no-inner-declarations
                async function getAuthData() {
                  const answer = await handleAuth();
                  if (!answer) setTimeout(() => getAuthData(), 1000);
                }

                getAuthData();

                resolve("success");
              } catch (e) {
                console.error(e);
                reject(e);
              }
            },
            onFailure: (a) => {
              console.error(a);
              reject(a);
            },
          });
        },
        onFailure: (err) => {
          console.log(err);
          reject(err);
        },
        selectMFAType: () => {
          cognitoUser.sendMFASelectionAnswer("SOFTWARE_TOKEN_MFA", {
            onSuccess: () => {
              resolve(true);
            },
            onFailure: (a) => {
              console.error(a);
              reject(a);
            },
          });
        },
      });
    });
  };

  const enableMfa = (
    token: string,
    deviceName: string,
    sms: boolean,
    password: string
  ) => {
    const cognitoUser = new CognitoUser({
      Username: userData?.email,
      Pool: Pool,
    });
    const authDetails = new AuthenticationDetails({
      Username: userData?.email,
      Password: password,
    });

    const softwareTokenMfaSettings = {
      PreferredMfa: true,
      Enabled: true,
    };

    const smsMfaSettings = softwareTokenMfaSettings;

    return new Promise((resolve, reject) => {
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: () => {
          cognitoUser.verifySoftwareToken(token, deviceName, {
            onSuccess: async () => {
              cognitoUser.setUserMfaPreference(
                sms ? smsMfaSettings : null,
                sms ? null : softwareTokenMfaSettings,
                (err) => {
                  if (err) {
                    console.error(err);
                    reject(err);
                  }
                }
              );
              resolve("success");
            },
            onFailure: (a) => {
              console.error(a);
              reject(a);
            },
          });
        },
        onFailure: (err) => {
          console.log(err);
        },
        selectMFAType: () => {
          cognitoUser.sendMFASelectionAnswer("SOFTWARE_TOKEN_MFA", {
            onSuccess: () => {
              resolve(true);
            },
            onFailure: (a) => {
              console.error(a);
              reject(a);
            },
          });
        },
      });
    });
  };
  const disableMfa = async (password: string, code: string) => {
    const promise = () => {
      const cognitoUser = new CognitoUser({
        Username: userData?.email,
        Pool: Pool,
      });

      const authenticationData = {
        Username: userData?.email,
        Password: password,
      };

      const totpMfaSettings = {
        PreferredMfa: false,
        Enabled: false,
      };

      const authenticationDetails = new AuthenticationDetails(
        authenticationData
      );

      return new Promise((resolve, reject) =>
        cognitoUser.authenticateUser(authenticationDetails, {
          onSuccess: () => {
            resolve(true);
          },
          totpRequired: () => {
            cognitoUser.sendMFACode(
              code,
              {
                onSuccess: () => {
                  cognitoUser.setUserMfaPreference(
                    null,
                    totpMfaSettings,
                    (err) => {
                      if (err) {
                        console.error(err);
                        reject(err);
                      }
                    }
                  );
                  resolve(true);
                },
                onFailure: (error) => {
                  let message = "";
                  if (error instanceof Error) message = error.message;
                  console.log("message", message);
                  reject(message);
                },
              },
              "SOFTWARE_TOKEN_MFA"
            );
          },
          onFailure: (err) => {
            console.error(err);
            reject(err);
          },
        })
      );
    };
    const result = await promise();

    return result;
  };

  const forgotPassword = async (email?: string) => {
    const promise = () => {
      return new Promise((resolve, reject) => {
        const cognitoUser: CognitoUser = new CognitoUser({
          Username: email || userData?.email,
          Pool: Pool,
        });
        cognitoUser.forgotPassword({
          onSuccess: (success) => {
            setUserData({
              ...userData,
              email: email || userData?.email,
            });

            resolve(success);
          },
          onFailure: (error) => reject(error),
        });
      });
    };
    const result = await promise();

    return result;
  };

  const changePassword = async (oldpassword: string, newpassword: string) => {
    const { currentUser } = await userSession();
    return new Promise((resolve, reject) => {
      currentUser.changePassword(oldpassword, newpassword, (error) => {
        if (error) {
          reject(false);
        }

        resolve(true);
      });
    });
  };

  const confirmPassword = async (
    verificationCode: string,
    newPassword: string
  ) => {
    const promise = () => {
      return new Promise((resolve, reject) => {
        const cognitoUser: CognitoUser = new CognitoUser({
          Username: userData.email,
          Pool: Pool,
        });

        cognitoUser.confirmPassword(verificationCode, newPassword, {
          onSuccess: (success) => resolve(success),
          onFailure: (error) => {
            reject(error);
          },
        });
      });
    };
    const result = await promise();

    return result;
  };

  const fetchMfaStatus = async () => {
    const { currentUser } = await userSession();

    return new Promise<boolean>((resolve, reject) =>
      currentUser.getUserData(
        (err, data) => {
          if (err) {
            console.error("Error fetching MFA status");
            reject(false);
          }
          const { PreferredMfaSetting } = data || {};
          resolve(!!PreferredMfaSetting);
        },
        { bypassCache: true }
      )
    );
  };

  const fetchUserData = async (currentUser: CognitoUser) => {
    const idToken = currentUser.getSignInUserSession()?.getIdToken();
    const attributesList = await getUserAttributes(currentUser);

    const attributes: Record<string, string> = {};
    attributesList?.map((item) => {
      attributes[item.Name] = item.Value;
    });

    const userData: GetCustomerResponse = await getCustomer();

    // Checking presence of errors
    if ("Error" in userData) {
      throw new Error(userData.Error);
    }

    // Renaming keys
    const {
      ProfileImage: profileImage,
      ImageExpires: imageExpires,
      AccountExpired: accountExpired,
    } = userData as CustomerType;

    const company = attributes["custom:Company"];
    
    const data = {
      profileImage,
      imageExpires,
      cognitoUser: currentUser,
      email: currentUser.getUsername(),
      accessToken: idToken?.getJwtToken(),
      attributes: attributes,
      company: company || "",
      accountExpired: accountExpired || false,
      ...userData,
    };

    return data;
  };

  const handleAuth = async () => {
    /**
     * use @param shouldAuth variable to check if it should do the following logic
     *
     */

    try {
      const { currentUser } = await userSession();
      localStorage.removeItem("userData");

      const userData = await fetchUserData(currentUser);

      localStorage.setItem("userData", JSON.stringify(userData));
      setUserData(userData);
      setIsAuthenticated(true);
      return true;
    } catch (error) {
      console.log("Error when trying to authenticate", error);
      localStorage.removeItem("userData");
      return false;
    }
  };

  const checkIsLoggedIn = async () => {
    try {
      await userSession();
    } catch (error) {
      return false;
    }

    return true;
  };

  return {
    signIn,
    mfaSignIn,
    logOut,
    signUp,
    userSession,
    updateUserAttributes,
    setupUserInfo,
    isAuthenticated,
    isSigning,
    setIsAuthenticated,
    isChecking,
    setIsChecking,
    userData,
    setUserData,
    confirmEmail,
    resendCode,
    selectMfa,
    errorMessage,
    forgotPassword,
    confirmPassword,
    handleAuth,
    changePassword,
    changeTemporaryPassword,
    confirmMfaSetup,
    checkIsLoggedIn,
    fetchUserData,
    getUserAttributes,
    disableMfa,
    enableMfa,
    fetchMfaStatus,
  };
};
export default useAuth;
