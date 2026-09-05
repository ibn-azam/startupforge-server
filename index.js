const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const app = express();
require("dotenv").config();
const port = process.env.PORT;
const cors = require("cors");
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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

async function run() {
  try {
    await client.connect();

    const database = client.db("startupforge");
    const startupCollection = database.collection("startups");
    const opportunityCollection = database.collection("opportunities");
    const applicationCollection = database.collection("applications");
    const userCollection = database.collection("user");

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

    app.post("/api/startup", async (req, res) => {
      const {
        name,
        logoUrl,
        industry,
        description,
        fundingStage,
        founderEmail,
      } = req.body;

      const startup = {
        name,
        logoUrl,
        industry,
        description,
        fundingStage,
        founderEmail,
        createdAt: new Date(),
        status: "pending",
      };

      const result = await startupCollection.insertOne(startup);
      res.send(result);
    });

    app.delete("/api/startups/:id", async (req, res) => {
      const { id } = req.params;

      const result = await startupCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    app.patch("/api/startups/:id", async (req, res) => {
      const { id } = req.params;
      const result = await startupCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body },
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

    app.get("/api/opportunities/:email", async (req, res) => {
      const { email } = req.params;
      const result = await opportunityCollection
        .find({ founderEmail: email })
        .toArray();
      res.send(result);
    });

    app.post("/api/opportunity", async (req, res) => {
      const opportunity = req.body;
      const founder = await userCollection.findOne({
        email: opportunity?.founderEmail,
      });
      const founderOpportunitiesCounts =
        await opportunityCollection.countDocuments({
          founderEmail: opportunity?.founderEmail,
        });

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

    app.delete("/api/opportunities/:id", async (req, res) => {
      const { id } = req.params;

      const result = await opportunityCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });
    app.patch("/api/opportunities/:id", async (req, res) => {
      const { id } = req.params;
      const result = await opportunityCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body },
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
    app.post("/api/applications", async (req, res) => {
      const data = req.body;
      const application = {
        ...data,
        status: "Pending",
        appliedAt: new Date(),
      };
      const result = await applicationCollection.insertOne(application);
      res.send(result);
    });
    app.get("/api/applications/check", async (req, res) => {
      const { opportunityId, applicantEmail } = req.query;
      const existing = await applicationCollection.findOne({
        opportunityId,
        applicantEmail,
      });
      res.send({ hasApplied: !!existing });
    });

    // Collaborator: get their own applications, with opportunity details attached
    app.get("/api/applications/collaborator/:email", async (req, res) => {
      const { email } = req.params;
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
    });

    // Founder: get all applications for opportunities they posted
    app.get("/api/applications/founder/:email", async (req, res) => {
      const { email } = req.params;
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
    app.patch("/api/applications/:id", async (req, res) => {
      const { id } = req.params;
      const result = await applicationCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body },
      );
      res.send(result);
    });

    // All user Api
    app.patch("/api/user/:email", async (req, res) => {
      const { email } = req.params;
      const result = await userCollection.updateOne(
        { email: email },
        { $set: { isPremium: true } },
      );
      res.send(result);
    });

    // Admin Api
     app.get("/api/admin/stats", async (req, res) => {
    const [totalUsers, premiumUsers, founders, collaborators] = await Promise.all([
      userCollection.countDocuments(),
      userCollection.countDocuments({ isPremium: true }),
      userCollection.countDocuments({ role: "founder" }),
      userCollection.countDocuments({ role: "collaborator" }),
    ]);
    res.send({ totalUsers, premiumUsers, founders, collaborators });
  });

  app.get("/api/admin/users", async (req, res) => {
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
    res.send(records);
  });

  app.patch("/api/admin/users/:id/block", async (req, res) => {
    const { id } = req.params;
    const { isBlocked } = req.body;
    const result = await userCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isBlocked } },
    );
    res.send(result);
  });

  app.get("/api/admin/startups", async (req, res) => {
    const records = await startupCollection.find({}).sort({ createdAt: -1 }).toArray();
    res.send(records);
  });

  app.patch("/api/admin/startups/:id/approve", async (req, res) => {
    const { id } = req.params;
    const result = await startupCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "active" } },
    );
    res.send(result);
  });

  app.delete("/api/admin/startups/:id", async (req, res) => {
    const { id } = req.params;
    const result = await startupCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  });


    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB",
    );
  } finally {
    // await client.close();
  } 
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
