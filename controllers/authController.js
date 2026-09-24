const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ChatMessage = require("../models/ChatMessage"); // 🟢 ChatMessage Model Import
const sendEmail = require("../utils/sendEmail");
const connectDB = require("../config/db");

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// @desc    Register new user & send/resend verification email
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    await connectDB();

    const { name, email, password } = req.body;

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;

    const userExists = await User.findOne({ email });

    if (userExists) {
      // 🟢 Case 1: Account exists but is NOT verified -> Resend Verification Email
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
            <h2>Welcome back to NutriMorph, ${userExists.name}! 🎉</h2>
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

      // 🔴 Case 2: Account exists AND is verified
      return res.status(400).json({
        message: "User already exists and is verified. Please log in.",
      });
    }

    // 🟢 Case 3: Completely New User Creation
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
        <h2>Welcome to NutriMorph, ${name}! 🎉</h2>
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

// @desc    Verify User Email Token
// @route   GET /api/auth/verify-email
// @access  Public
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
        <h1 style="color: #10B981;">Email Verified Successfully! 🎉</h1>
        <p>Your account is active now. You can close this tab and log in to the app.</p>
      </div>
    `);
  } catch (error) {
    console.error("Verify Email Error:", error);
    res.status(500).send("<h3>Server error during email verification.</h3>");
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
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
      isOnboarded: user.isOnboarded,
      dailyCalories: user.dailyCalories || 2000,
      dailyCalorieGoal: user.dailyCalorieGoal || user.dailyCalories || 2000,
      subscriptionTier: user.subscriptionTier || "free",
      isPro: user.isPro || false,
      avatar: user.avatar || user.profileImage || null,
      macros: user.macros,
      weight: user.weight,
      height: user.height,
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get logged in user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    await connectDB();
    res.status(200).json(req.user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update Health & Personal Profile
// @route   PUT /api/auth/profile
// @access  Private
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
      subscriptionTier,
      isPro,
    } = req.body;

    if (name) user.name = name;
    if (email) user.email = email;
    if (profileImage !== undefined) user.profileImage = profileImage;
    if (avatar !== undefined) user.avatar = avatar;

    if (subscriptionTier !== undefined) {
      user.subscriptionTier = subscriptionTier;
      user.isPro = subscriptionTier === "pro";
    }
    if (isPro !== undefined) {
      user.isPro = isPro;
    }

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

// @desc    Delete User Account & Cascade Delete Associated Data
// @route   DELETE /api/auth/me
// @access  Private
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
  getMe,
  updateProfile,
  deleteAccount,
};
