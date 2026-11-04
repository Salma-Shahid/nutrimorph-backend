const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ChatMessage = require("../models/ChatMessage"); //  ChatMessage Model Import
const sendEmail = require("../utils/sendEmail");
const connectDB = require("../config/db");
const isProUser = require("../utils/isProUser");
const normalizeSubscription = require("../utils/normalizeSubscription");

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

const getSubscriptionStatus = (user) => {
  const isPro = isProUser(user);
  return {
    subscriptionTier: isPro ? "pro" : "free",
    isPro,
  };
};

// @desc Register new user & send/resend verification email
// @route POST /api/auth/register
// @access Public
const register = async (req, res) => {
  try {
    await connectDB();

    const { name, email, password } = req.body;

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;

    const userExists = await User.findOne({ email });

    if (userExists) {
      //  Case 1: Account exists but is NOT verified -> Resend Verification Email
      if (!userExists.isVerified) {
        const salt = await bcrypt.genSalt(10);
        userExists.password = await bcrypt.hash(password, salt);
        if (name) userExists.name = name;
        userExists.verificationToken = verificationToken;
        userExists.verificationTokenExpires = verificationTokenExpires;

        await userExists.save();

        const baseUrl =
          process.env.BACKEND_URL || `${req.protocol}://${req.get("host")}`;
        const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${verificationToken}&id=${userExists._id}`;

        const emailTemplate = `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2>Welcome back to NutriMorph, ${userExists.name}! </h2>
            <p>Please verify your email address to activate your account.</p>
            <a href="${verifyUrl}" style="background-color: #10B981; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block; margin-top: 10px;">Verify Email Address</a>
            <p style="margin-top: 20px; color: #666; font-size: 12px;">This link will expire in 24 hours.</p>
          </div>
`;

        await sendEmail({
          email: userExists.email,
          subject: "NutriMorph - Verify Your Email Address",
          html: emailTemplate,
        });

        return res.status(200).json({
          success: true,
          message: "Please check your email address to verify your account.",
        });
      }

      //  Case 2: Account exists AND is verified
      return res.status(400).json({
        message: "User already exists and is verified. Please log in.",
      });
    }

    //  Case 3: Completely New User Creation
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      subscriptionTier: "free",
      isPro: false,
      isVerified: false,
      verificationToken,
      verificationTokenExpires,
    });

    const baseUrl =
      process.env.BACKEND_URL || `${req.protocol}://${req.get("host")}`;
    const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${verificationToken}&id=${user._id}`;

    const emailTemplate = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Welcome to NutriMorph, ${name}! </h2>
        <p>Thank you for signing up. Please verify your email address to activate your account.</p>
        <a href="${verifyUrl}" style="background-color: #10B981; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block; margin-top: 10px;">Verify Email Address</a>
        <p style="margin-top: 20px; color: #666; font-size: 12px;">This link will expire in 24 hours.</p>
      </div>
`;

    await sendEmail({
      email: user.email,
      subject: "NutriMorph - Email Verification",
      html: emailTemplate,
    });

    res.status(201).json({
      success: true,
      message:
        "Registration successful! Please check your email to verify your account.",
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: error.message || "Registration failed" });
  }
};

// @desc Verify User Email Token
// @route GET /api/auth/verify-email
// @access Public
const verifyEmail = async (req, res) => {
  try {
    await connectDB();

    const { token, id } = req.query;

    if (!token || !id) {
      return res
        .status(400)
        .send("<h3>Invalid verification link parameters.</h3>");
    }

    const user = await User.findOne({
      _id: id,
      verificationToken: token,
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .send("<h3>Invalid or expired verification link.</h3>");
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    res.send(`
      <div style="text-align: center; font-family: Arial, sans-serif; padding: 50px;">
        <h1 style="color: #10B981;">Email Verified Successfully! </h1>
        <p>Your account is active now. You can close this tab and log in to the app.</p>
      </div>
`);
  } catch (error) {
    console.error("Verify Email Error:", error);
    res.status(500).send("<h3>Server error during email verification.</h3>");
  }
};

// @desc Authenticate user & get token
// @route POST /api/auth/login
// @access Public
const login = async (req, res) => {
  try {
    await connectDB();

    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    await normalizeSubscription(user);

    // Email Verification Guard Check
    if (!user.isVerified) {
      return res.status(403).json({
        isVerified: false,
        message: "Please verify your email address before logging in.",
      });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isOnboarded: user.isOnboarded || user.isOnboardingCompleted || false,
      role: user.role || "user",
      dailyCalories: user.dailyCalories || 2000,
      dailyCalorieGoal: user.dailyCalorieGoal || user.dailyCalories || 2000,
      ...getSubscriptionStatus(user),
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      subscriptionStatus: user.subscriptionStatus,
      trialEndDate: user.trialEndDate,
      trialUsedAt: user.trialUsedAt,
      dailyChatCount: user.dailyChatCount,
      lastChatDate: user.lastChatDate,
      dailyScanCount: user.dailyScanCount,
      dailyScanDate: user.dailyScanDate,
      avatar: user.avatar || user.profileImage || null,
      macros: user.macros || user.macrosTarget,
      weight: user.weight,
      height: user.height,
      targetWeight: user.targetWeight,
      dailyCalorieTarget:
        user.dailyCalorieTarget || user.dailyCalorieGoal || user.dailyCalories,
      medicalCondition: user.medicalCondition,
      unlockedBadges: user.unlockedBadges || [],
      steps: user.steps || 0,
      preferredMealsCount: user.preferredMealsCount || 4,
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: error.message });
  }
};

const requestPasswordReset = async (req, res) => {
  const genericResponse = {
    success: true,
    message:
      "If an account exists for that email address, a password reset link will be sent.",
  };
  try {
    await connectDB();
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    if (!email) return res.status(200).json(genericResponse);

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json(genericResponse);

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    user.passwordResetTokenExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();

    const appUrl = (
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      "https://nutrimorph.app"
    ).replace(/\/$/, "");
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;
    await sendEmail({
      email,
      subject: "Reset your NutriMorph password",
      html: `<div style="font-family:Arial,sans-serif;color:#111827"><h2>Reset your NutriMorph password</h2><p>Use the secure link below within 30 minutes to choose a new password.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this change, you can ignore this message.</p></div>`,
    });
    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error("Password reset request failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not send a password reset email. Please try again later.",
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    await connectDB();
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const token = String(req.body.token || "");
    const password = String(req.body.password || "");
    if (!email || !token || password.length < 8) {
      return res.status(400).json({
        success: false,
        message:
          "Email, reset token, and a password of at least 8 characters are required.",
      });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      email,
      passwordResetToken: hashedToken,
      passwordResetTokenExpires: { $gt: new Date() },
    }).select("+passwordResetToken +passwordResetTokenExpires");
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "The password reset link is invalid or has expired.",
      });
    }

    user.password = await bcrypt.hash(password, await bcrypt.genSalt(10));
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpires = undefined;
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Password updated. You can now sign in with your new password.",
    });
  } catch (error) {
    console.error("Password reset failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not reset the password. Please try again.",
    });
  }
};

// @desc Get logged in user profile
// @route GET /api/auth/me & /api/auth/profile
// @access Private
const getMe = async (req, res) => {
  try {
    await connectDB();
    const user = await User.findById(req.user._id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    await normalizeSubscription(user);
    const subscription = getSubscriptionStatus(user);
    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        ...subscription,
        role: user.role || "user",
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        subscriptionStatus: user.subscriptionStatus,
        trialEndDate: user.trialEndDate,
        trialUsedAt: user.trialUsedAt,
        dailyChatCount: user.dailyChatCount,
        lastChatDate: user.lastChatDate,
        dailyScanCount: user.dailyScanCount,
        dailyScanDate: user.dailyScanDate,
        dailyCalories: user.dailyCalories || user.dailyCalorieGoal || 2000,
        dailyCalorieGoal: user.dailyCalorieGoal || user.dailyCalorieTarget,
        dailyCalorieTarget:
          user.dailyCalorieTarget ||
          user.dailyCalorieGoal ||
          user.dailyCalories,
        avatar: user.avatar,
        profileImage: user.profileImage,
        age: user.age,
        gender: user.gender,
        weight: user.weight,
        height: user.height,
        goal: user.goal,
        fitnessGoal: user.fitnessGoal,
        medicalCondition: user.medicalCondition,
        unlockedBadges: user.unlockedBadges || [],
        steps: user.steps || 0,
        lastLoggedDate: user.lastLoggedDate || null,
        streakCount: user.streakCount || 0,
        isOnboarded: user.isOnboarded || user.isOnboardingCompleted,
        preferredMealsCount: user.preferredMealsCount || 4,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc Update Health & Personal Profile
// @route PUT /api/auth/profile
// @access Private
const updateProfile = async (req, res) => {
  try {
    await connectDB();

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const {
      name,
      email,
      profileImage,
      avatar,
      age,
      gender,
      weight,
      height,
      goal,
      calorieTarget,
      dailyCalorieGoal,
    } = req.body;

    if (name) user.name = name;
    if (email) user.email = email;
    if (profileImage !== undefined) user.profileImage = profileImage;
    if (avatar !== undefined) user.avatar = avatar;

    const numAge = age !== undefined ? Number(age) : user.age;
    const numWeight = weight !== undefined ? Number(weight) : user.weight;
    const numHeight = height !== undefined ? Number(height) : user.height;
    const userGender = gender || user.gender;
    const userGoal = goal || user.goal;

    if (numAge) user.age = numAge;
    if (numWeight) user.weight = numWeight;
    if (numHeight) user.height = numHeight;
    if (userGender) user.gender = userGender;
    if (userGoal) user.goal = userGoal;

    let targetCalories = user.dailyCalories || user.dailyCalorieGoal || 2000;
    const manualCalorieGoal = calorieTarget || dailyCalorieGoal;

    if (manualCalorieGoal) {
      targetCalories = Number(manualCalorieGoal);
    } else if (numAge && numWeight && numHeight && userGender) {
      let bmr = 10 * numWeight + 6.25 * numHeight - 5 * numAge;
      bmr += userGender === "female" ? -161 : 5;

      let tdee = Math.round(bmr * 1.375);
      targetCalories = tdee;

      if (userGoal === "weight_loss") targetCalories -= 500;
      else if (userGoal === "muscle_gain") targetCalories += 300;

      targetCalories = Math.max(1200, targetCalories);
    }

    user.dailyCalories = targetCalories;
    user.dailyCalorieGoal = targetCalories;

    user.macros = {
      protein: Math.round((targetCalories * 0.3) / 4),
      carbs: Math.round((targetCalories * 0.4) / 4),
      fats: Math.round((targetCalories * 0.3) / 9),
    };

    user.isOnboarded = true;

    const updatedUser = await user.save();
    const userResponse = updatedUser.toObject();
    delete userResponse.password;

    res.status(200).json(userResponse);
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc Complete Onboarding Wizard Flow
// @route POST /api/auth/onboarding
// @access Private
const completeOnboarding = async (req, res) => {
  try {
    await connectDB();

    const userId = req.user?._id || req.user?.id;
    const user = await User.findById(userId);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const {
      name,
      language,
      gender,
      dob,
      age: providedAge,
      height,
      weight,
      currentWeight,
      targetWeight,
      fitnessGoal,
      goal,
      activityLevel,
      preferredMealsCount,
      dailyCalorieTarget: providedCalorieTarget,
      dailyCalories: providedDailyCalories,
      proteinTarget,
      carbsTarget,
      fatsTarget,
      medicalCondition,
      bmi: providedBmi,
    } = req.body;

    let age = Number(providedAge) || user.age || 25;
    if (!providedAge && dob) {
      const birthDate = new Date(dob);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birthDate.getDate())
      ) {
        age--;
      }
    }

    // 2. Unit Conversions
    const heightVal =
      (typeof height === "object" ? height?.value : height) ||
      user.height ||
      170;
    const heightUnit =
      (typeof height === "object" ? height?.unit : null) || "cm";
    const heightInCm = heightUnit === "ft" ? heightVal * 30.48 : heightVal;
    const heightInMeters = heightInCm / 100;

    const weightInput = currentWeight ?? weight;
    const weightVal =
      (typeof weightInput === "object" ? weightInput?.value : weightInput) ||
      user.weight ||
      70;
    const weightUnit =
      (typeof weightInput === "object" ? weightInput?.unit : null) || "kg";
    const weightInKg = weightUnit === "lbs" ? weightVal * 0.453592 : weightVal;

    const bmi =
      Number(providedBmi) ||
      parseFloat((weightInKg / (heightInMeters * heightInMeters)).toFixed(1));
    let bmiCategory = "Normal";
    if (bmi < 18.5) bmiCategory = "Underweight";
    else if (bmi >= 25 && bmi < 29.9) bmiCategory = "Overweight";
    else if (bmi >= 30) bmiCategory = "Obese";

    // 4. BMR Calculation (Mifflin-St Jeor)
    let bmr = 10 * weightInKg + 6.25 * heightInCm - 5 * age;
    bmr += gender === "Female" || gender === "female" ? -161 : 5;

    // 5. Activity Multiplier (TDEE)
    const activityMultipliers = {
      "Not very active": 1.2,
      "Lightly active": 1.375,
      Active: 1.55,
      "Very active": 1.725,
    };

    const selectedGoal = fitnessGoal || goal || user.fitnessGoal || user.goal;
    let tdee = bmr * (activityMultipliers[activityLevel] || 1.375);

    // Goal Adjustments
    if (selectedGoal === "Lose Weight" || selectedGoal === "weight_loss")
      tdee -= 500;
    else if (selectedGoal === "Gain Weight" || selectedGoal === "muscle_gain")
      tdee += 400;

    const dailyCalorieTarget = Math.max(
      1200,
      Number(providedCalorieTarget) ||
        Number(providedDailyCalories) ||
        Math.round(tdee),
    );

    const macrosTarget = {
      protein:
        Number(proteinTarget) || Math.round((dailyCalorieTarget * 0.3) / 4),
      carbs: Number(carbsTarget) || Math.round((dailyCalorieTarget * 0.4) / 4),
      fats: Number(fatsTarget) || Math.round((dailyCalorieTarget * 0.3) / 9),
    };

    if (typeof name === "string" && name.trim()) user.name = name.trim();
    user.language = language || user.language || "English";
    user.gender = gender || user.gender;
    if (dob) user.dob = dob;
    user.age = age;
    user.height = heightInCm;
    user.weight = weightInKg;
    user.targetWeight =
      (typeof targetWeight === "object" ? targetWeight?.value : targetWeight) ??
      user.targetWeight;
    user.bmi = bmi;
    user.bmiCategory = bmiCategory;
    user.goal = selectedGoal || user.goal;
    user.fitnessGoal = selectedGoal || user.fitnessGoal;
    user.activityLevel = activityLevel || user.activityLevel;
    user.medicalCondition = medicalCondition || user.medicalCondition || "None";
    user.preferredMealsCount =
      preferredMealsCount || user.preferredMealsCount || 4;
    user.dailyCalories = dailyCalorieTarget;
    user.dailyCalorieGoal = dailyCalorieTarget;
    user.dailyCalorieTarget = dailyCalorieTarget;
    user.macros = macrosTarget;
    user.isOnboarded = true;
    user.isOnboardingCompleted = true;

    const updatedUser = await user.save();
    const userResponse = updatedUser.toObject();
    delete userResponse.password;

    return res.status(200).json({
      success: true,
      message: "Onboarding completed successfully!",
      user: userResponse,
    });
  } catch (error) {
    console.error("Complete Onboarding Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Delete User Account & Cascade Delete Associated Data
// @route DELETE /api/auth/me
// @access Private
const deleteAccount = async (req, res) => {
  try {
    await connectDB();

    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated.",
      });
    }

    // 1. Cascade delete all user chat history from MongoDB
    await ChatMessage.deleteMany({
      $or: [{ user: userId }, { userId: userId }],
    });

    // 2. Delete user profile record from MongoDB
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({
        success: false,
        message: "User record not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Your account and all associated data have been permanently deleted.",
    });
  } catch (error) {
    console.error("Delete Account Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete account. Try again.",
    });
  }
};

module.exports = {
  register,
  verifyEmail,
  login,
  requestPasswordReset,
  resetPassword,
  getMe,
  updateProfile,
  completeOnboarding, //  Added Onboarding Handler
  deleteAccount,
};
