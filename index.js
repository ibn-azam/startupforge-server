const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const app = express();
require("dotenv").config();
const port = process.env.PORT;
const cors = require("cors");
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  }),
);
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res
        .status(400)
        .json({ message: "Webhook configuration is incomplete." });
    }

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email;
        const transactionId = session.id;

        if (email && transactionId) {
          const paymentResult = await paymentsCollection.updateOne(
            { transaction_id: transactionId },
            {
              $setOnInsert: {
                user_email: email,
                amount: session.amount_total || 0,
                transaction_id: transactionId,
                payment_status: session.payment_status || "paid",
                paid_at: session.created
                  ? new Date(session.created * 1000)
                  : new Date(),
                createdAt: new Date(),
              },
            },
            { upsert: true },
          );
          await userCollection.updateOne(
            { email },
            { $set: { isPremium: true } },
          );
          console.info(
            "Stripe payment recorded:",
            transactionId,
            paymentResult.upsertedCount ? "inserted" : "already recorded",
          );
        }
      }

      return res.json({ received: true });
    } catch (error) {
      console.error("Stripe webhook verification failed:", error.message);
      return res.status(400).json({ message: "Invalid webhook signature." });
    }
  },
);
app.use(express.json());
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

const uri = process.env.MONGODB_URI;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(new URL(process.env.JWKS));

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const verifyOptions = {
      algorithms: (process.env.JWT_ALGORITHMS || "EdDSA")
        .split(",")
        .map((algorithm) => algorithm.trim()),
      ...(process.env.JWT_ISSUER ? { issuer: process.env.JWT_ISSUER } : {}),
      ...(process.env.JWT_AUDIENCE
        ? { audience: process.env.JWT_AUDIENCE }
        : {}),
    };
    const { payload } = await jwtVerify(token, JWKS, verifyOptions);
    if (!payload.sub || typeof payload.email !== "string") {
      return res.status(401).json({ message: "Invalid token claims." });
    }
    const dbUser = await userCollection.findOne(
      { email: payload.email },
      { projection: { role: 1, isBlocked: 1 } },
    );
    if (!dbUser || dbUser.isBlocked) {
      return res.status(403).json({ message: "Account is not active." });
    }
    req.dbUser = dbUser;
    req.user = payload;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Forbidden" });
  }
};

const requireAdmin = async (req, res, next) => {
  const user = await userCollection.findOne(
    { email: req.user.email },
    { projection: { role: 1, isBlocked: 1 } },
  );
  if (!user || user.isBlocked || user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required." });
  }
  req.dbUser = user;
  next();
};

// async function run() {
//   try {
//     await client.connect();

client
  .connect(() => {
    console.log("çonnecting to MongoDB");
  })
  .catch(console.dir);

const database = client.db(process.env.DB);
const startupCollection = database.collection("startups");
const opportunityCollection = database.collection("opportunities");
const applicationCollection = database.collection("applications");
const userCollection = database.collection("user");
const paymentsCollection = database.collection("payments");

// All Payment Api
app.post("/api/payments", verifyToken, async (req, res) => {
  try {
    const { user_email, amount, transaction_id, payment_status, paid_at } =
      req.body;

    if (!user_email || !transaction_id) {
      return res
        .status(400)
        .json({ message: "Missing required payment fields." });
    }

    const existing = await paymentsCollection.findOne({ transaction_id });
    if (existing) return res.status(200).json(existing);

    if (req.user.email !== user_email) {
      return res
        .status(403)
        .json({ message: "Payment user does not match token." });
    }

    const stripeSession =
      await stripe.checkout.sessions.retrieve(transaction_id);
    const stripeEmail =
      stripeSession.customer_details?.email || stripeSession.customer_email;
    if (
      stripeEmail !== user_email ||
      stripeSession.payment_status !== "paid" ||
      stripeSession.amount_total !== amount
    ) {
      return res
        .status(400)
        .json({ message: "Payment could not be verified." });
    }

    const payment = {
      user_email,
      amount: stripeSession.amount_total,
      transaction_id,
      payment_status: stripeSession.payment_status,
      paid_at: paid_at ? new Date(paid_at) : new Date(),
      createdAt: new Date(),
    };

    const result = await paymentsCollection.insertOne(payment);
    await userCollection.updateOne(
      { email: user_email },
      { $set: { isPremium: true } },
    );
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to record payment." });
  }
});

app.get("/api/payments/me", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user?.email;

    if (!userEmail) {
      return res
        .status(400)
        .json({ message: "User email not found in token." });
    }

    const payments = await paymentsCollection
      .find({ user_email: userEmail })
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json(payments);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payments." });
  }
});

// New Admin Api
// Admin Stats
app.get("/api/admin/stats", verifyToken, requireAdmin, async (req, res) => {
  try {
    const [totalUsers, premiumUsers, founders, collaborators] =
      await Promise.all([
        userCollection.countDocuments(),
        userCollection.countDocuments({ isPremium: true }),
        userCollection.countDocuments({ role: "founder" }),
        userCollection.countDocuments({ role: "collaborator" }),
      ]);

    const revenue = await paymentsCollection
      .aggregate([
        {
          $match: {
            $or: [
              { payment_status: { $regex: /^(paid|completed)$/i } },
              { status: { $regex: /^(paid|completed)$/i } },
            ],
          },
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $convert: {
                  input: { $ifNull: ["$amount", 0] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
        },
      ])
      .toArray();

    const totalRevenue = revenue[0]?.total || 0;

    res.json({
      totalUsers,
      premiumUsers,
      founders,
      collaborators,
      totalRevenue,
    });
  } catch (error) {
    console.error("Stats API error:", error);
    res.status(500).json({ message: "Failed to fetch admin stats." });
  }
});

// Admin Users List
app.get("/api/admin/users", verifyToken, requireAdmin, async (req, res) => {
  try {
    const records = await userCollection
      .find(
        {},
        {
          projection: {
            name: 1,
            email: 1,
            role: 1,
            image: 1,
            isPremium: 1,
            isBlocked: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch users." });
  }
});

// Admin Block/Unblock User
app.patch(
  "/api/admin/users/:id/block",
  verifyToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isBlocked } = req.body;
      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isBlocked } },
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({ message: "Failed to update user block status." });
    }
  },
);

// Admin Startups List
app.get("/api/admin/startups", verifyToken, requireAdmin, async (req, res) => {
  try {
    const records = await startupCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch startups." });
  }
});

// Admin Approve Startup
app.patch(
  "/api/admin/startups/:id/approve",
  verifyToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const result = await startupCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "active" } },
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({ message: "Failed to approve startup." });
    }
  },
);

// Admin Delete Startup
app.delete(
  "/api/admin/startups/:id",
  verifyToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const result = await startupCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ message: "Failed to delete startup." });
    }
  },
);

// Admin Stripe Transactions
app.get(
  "/api/admin/transactions",
  verifyToken,
  requireAdmin,
  async (req, res) => {
    try {
      const transactions = await paymentsCollection
        .find({})
        .sort({ paid_at: -1 })
        .limit(100)
        .toArray();
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch transactions." });
    }
  },
);

// All Startups Api

app.get("/api/startups", async (req, res) => {
  const { search, industry } = req.query;
  const query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  if (industry) {
    query.industry = { $in: industry.split(",") };
  }

  const result = await startupCollection.find(query).toArray();
  res.send(result);
});

app.get("/api/startups/:email", async (req, res) => {
  const { email } = req.params;
  const result = await startupCollection
    .find({ founderEmail: email })
    .toArray();

  res.send(result);
});

app.get("/api/startup/:id", async (req, res) => {
  const { id } = req.params;
  const result = await startupCollection.findOne({
    _id: new ObjectId(id),
  });
  res.send(result);
});

app.post("/api/startup", verifyToken, async (req, res) => {
  const { name, logoUrl, industry, description, fundingStage } = req.body;
  if (req.dbUser.role !== "founder")
    return res.status(403).json({ message: "Founder access required." });

  const startup = {
    name,
    logoUrl,
    industry,
    description,
    fundingStage,
    founderEmail: req.user.email,
    createdAt: new Date(),
    status: "pending",
  };

  const result = await startupCollection.insertOne(startup);
  res.send(result);
});

app.delete("/api/startups/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  const result = await startupCollection.deleteOne({
    _id: new ObjectId(id),
    founderEmail: req.user.email,
  });

  res.send(result);
});

app.patch("/api/startups/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const result = await startupCollection.updateOne(
    { _id: new ObjectId(id), founderEmail: req.user.email },
    { $set: { ...req.body, founderEmail: req.user.email } },
  );
  res.send(result);
});

// All Opportunities Api

app.get("/opportunities/latest", async (req, res) => {
  const limit = parseInt(req.query.limit) || 3;

  const latest = await opportunityCollection
    .find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  res.send(latest);
});

app.get("/api/opportunities/:email", verifyToken, async (req, res) => {
  const { email } = req.params;
  if (email !== req.user.email)
    return res.status(403).json({ message: "Access denied." });
  const result = await opportunityCollection
    .find({ founderEmail: email })
    .toArray();
  res.send(result);
});

app.post("/api/opportunity", verifyToken, async (req, res) => {
  if (req.dbUser.role !== "founder")
    return res.status(403).json({ message: "Founder access required." });
  const opportunity = { ...req.body, founderEmail: req.user.email };
  const founder = await userCollection.findOne({
    email: opportunity?.founderEmail,
  });
  const founderOpportunitiesCounts = await opportunityCollection.countDocuments(
    {
      founderEmail: opportunity?.founderEmail,
    },
  );

  if (!founder?.isPremium && founderOpportunitiesCounts >= 3) {
    return res.status(401).send({
      message: "Your free limit is over.",
    });
  }

  const result = await opportunityCollection.insertOne({
    ...opportunity,
    status: "pending",
  });
  res.send(result);
});

app.delete("/api/opportunities/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  const result = await opportunityCollection.deleteOne({
    _id: new ObjectId(id),
    founderEmail: req.user.email,
  });

  res.send(result);
});
app.patch("/api/opportunities/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const result = await opportunityCollection.updateOne(
    { _id: new ObjectId(id), founderEmail: req.user.email },
    { $set: { ...req.body, founderEmail: req.user.email } },
  );
  res.send(result);
});

// Browse Opportunities Api
app.get("/api/opportunities", async (req, res) => {
  const { search, workType, industry, page = 1, limit = 6 } = req.query;

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 6;
  const skip = (pageNum - 1) * limitNum;

  const query = {};

  if (search) {
    query.$or = [
      { roleTitle: { $regex: search, $options: "i" } },
      { requiredSkills: { $regex: search, $options: "i" } },
    ];
  }

  if (workType) {
    query.workType = { $in: workType.split(",") };
  }

  if (industry) {
    query.industry = { $in: industry.split(",") };
  }

  const totalCount = await opportunityCollection.countDocuments(query);

  const result = await opportunityCollection
    .find(query)
    .skip(skip)
    .limit(limitNum)
    .toArray();

  const totalPages = Math.ceil(totalCount / limitNum) || 1;

  res.json({
    data: result,
    totalCount,
    totalPages,
    currentPage: pageNum,
  });
});

app.get("/api/opportunity/:id", async (req, res) => {
  const { id } = req.params;
  const result = await opportunityCollection.findOne({
    _id: new ObjectId(id),
  });
  res.send(result);
});

// All Applications Api
app.post("/api/applications", verifyToken, async (req, res) => {
  if (req.dbUser.role !== "collaborator")
    return res.status(403).json({ message: "Collaborator access required." });
  const data = { ...req.body, applicantEmail: req.user.email };
  const application = {
    ...data,
    status: "Pending",
    appliedAt: new Date(),
  };
  const result = await applicationCollection.insertOne(application);
  res.send(result);
});
app.get("/api/applications/check", verifyToken, async (req, res) => {
  const { opportunityId } = req.query;
  const existing = await applicationCollection.findOne({
    opportunityId,
    applicantEmail: req.user.email,
  });
  res.send({ hasApplied: !!existing });
});

// Collaborator: get their own applications, with opportunity details attached
app.get(
  "/api/applications/collaborator/:email",
  verifyToken,
  async (req, res) => {
    const { email } = req.params;
    if (email !== req.user.email)
      return res.status(403).json({ message: "Access denied." });
    const result = await applicationCollection
      .aggregate([
        { $match: { applicantEmail: email } },
        {
          $lookup: {
            from: "opportunities",
            let: { oppId: { $toObjectId: "$opportunityId" } },
            pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$oppId"] } } }],
            as: "opportunity",
          },
        },
        {
          $unwind: { path: "$opportunity", preserveNullAndEmptyArrays: true },
        },
      ])
      .toArray();
    res.send(result);
  },
);

// Founder: get all applications for opportunities they posted
app.get("/api/applications/founder/:email", verifyToken, async (req, res) => {
  const { email } = req.params;
  if (email !== req.user.email)
    return res.status(403).json({ message: "Access denied." });
  const result = await applicationCollection
    .aggregate([
      {
        $lookup: {
          from: "opportunities",
          let: { oppId: { $toObjectId: "$opportunityId" } },
          pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$oppId"] } } }],
          as: "opportunity",
        },
      },
      { $unwind: "$opportunity" },
      { $match: { "opportunity.founderEmail": email } },
    ])
    .toArray();
  res.send(result);
});

// Founder: accept or reject an application
app.patch("/api/applications/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  if (req.dbUser.role !== "founder")
    return res.status(403).json({ message: "Founder access required." });
  const application = await applicationCollection.findOne({
    _id: new ObjectId(id),
  });
  if (!application)
    return res.status(404).json({ message: "Application not found." });
  const opportunity = await opportunityCollection.findOne({
    _id: new ObjectId(application.opportunityId),
  });
  if (!opportunity || opportunity.founderEmail !== req.user.email) {
    return res.status(403).json({ message: "Access denied." });
  }
  const result = await applicationCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: req.body.status } },
  );
  res.send(result);
});

// All user Api

app.get("/api/user/me", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;
    if (!email) {
      return res
        .status(401)
        .json({ message: "User email not found in token." });
    }

    const user = await userCollection.findOne(
      { email },
      {
        projection: {
          _id: 1,
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          isPremium: 1,
          isBlocked: 1,
          skills: 1,
          bio: 1,
        },
      },
    );

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (user.isBlocked) {
      return res
        .status(403)
        .json({ message: "Your account has been blocked." });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error("GET /me error:", error);
    res.status(500).json({ message: "Failed to fetch profile." });
  }
});

app.patch("/api/user/me", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;
    if (!email) {
      return res
        .status(401)
        .json({ message: "User email not found in token." });
    }

    const { name, image, skills, bio } = req.body;

    await userCollection.updateOne(
      { email },
      { $set: { name, image, skills, bio } },
    );

    const user = await userCollection.findOne(
      { email },
      {
        projection: {
          _id: 1,
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          isPremium: 1,
          isBlocked: 1,
          skills: 1,
          bio: 1,
        },
      },
    );

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error("PATCH /me error:", error);
    res.status(500).json({ message: "Failed to update profile." });
  }
});

app.delete("/api/user/me", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;
    if (!email) {
      return res
        .status(401)
        .json({ message: "User email not found in token." });
    }

    const result = await userCollection.deleteOne({ email });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    res.status(200).json({ message: "Account deleted successfully." });
  } catch (error) {
    console.error("DELETE /me error:", error);
    res.status(500).json({ message: "Failed to delete account." });
  }
});

// await client.db("admin").command({ ping: 1 });
//     console.log(
//       "Pinged your deployment. You successfully connected to MongoDB",
//     );
//   } finally {
//     // await client.close();
//   }
// }
// run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
module.exports = app;
