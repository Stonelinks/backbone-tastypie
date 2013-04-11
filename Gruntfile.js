// this Gruntfile will probably be useful for nobody

module.exports = function(grunt) {
  'use strict';

  // Dependencies
  // ------------
  
  grunt.loadNpmTasks('grunt-regarde');
  grunt.loadNpmTasks('grunt-exec');


  // Config
  // ------
  
  var SRC = 'static/js/backbone-tastypie.js';
  var DST = '../mujin/dev/mujinjsclient/mujincontroller/app/vendor/backbone-tastypie/backbone_tastypie/static/js/backbone-tastypie.js';

  grunt.initConfig({
    exec: {
      fixjsstyle: {
        command: 'fixjsstyle -r ' + SRC,
        stdout: true
      },
      copy: {
        command: function() {
          var cmds = [];
          cmds.push('cp -r ' + SRC + ' ' + DST);
          return cmds.join(' && ');
        },
        stdout: true
      }
    },
    regarde: {
      app: {
        files: SRC,
        tasks: ['exec:fixjsstyle', 'copy']
      }
    }
  });


  // Tasks
  // -----

  // handy watch to copy js to where i need it
  grunt.registerTask('watch', ['regarde']);
};
