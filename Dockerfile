# Use the official Node.js 16 as a parent image
FROM node:20

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy the current directory contents into the container at /usr/src/app
COPY . .

# Install any needed packages specified in package.json
RUN npm install

# Make port 3005 available to the world outside this container
EXPOSE 3005

# Run app.js when the container launches
CMD ["node", "server.js"]
