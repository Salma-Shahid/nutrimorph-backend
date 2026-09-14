const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User pehle se registered hai." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isOnboarded: user.isOnboarded,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isOnboarded: user.isOnboarded,
      dailyCalories: user.dailyCalories,
      macros: user.macros,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get logged in user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
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
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const {
      name,
      email,
      profileImage,
      age,
      gender,
      weight,
      height,
      goal,
      calorieTarget,
    } = req.body;

    // 1. Basic details update
    if (name) user.name = name;
    if (email) user.email = email;
    if (profileImage !== undefined) user.profileImage = profileImage;

    // 2. Health metrics update
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

    // 3. Calorie & Macro recalculation / override
    let targetCalories = user.dailyCalories || 2400;

    if (calorieTarget) {
      // Manual target set from Profile settings
      targetCalories = Number(calorieTarget);
    } else if (numAge && numWeight && numHeight && userGender) {
      // Mifflin-St Jeor Formula (Auto-calculate)
      let bmr = 10 * numWeight + 6.25 * numHeight - 5 * numAge;
      bmr += userGender === "female" ? -161 : 5;

      let tdee = Math.round(bmr * 1.375);
      targetCalories = tdee;

      if (userGoal === "weight_loss") targetCalories -= 500;
      else if (userGoal === "muscle_gain") targetCalories += 300;

      targetCalories = Math.max(1200, targetCalories);
    }

    user.dailyCalories = targetCalories;

    // Recalculate Macros based on target calories
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
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
};
